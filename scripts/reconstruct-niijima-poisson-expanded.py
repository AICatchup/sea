"""Reconstruct an explicitly inferred Niijima cliff study from an existing Tokyo LAS ZIP.

Requires numpy, scipy, laspy, pyproj and open3d==0.19.0. No downloads, archive
copying, runtime adoption, or changes to existing output directories are performed.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time
import zipfile

SOURCE_SHA = '731881a1d95cd52a475912edceec9892670fbd3ebb3d3ac2b7c173e54e6a3e25'
SOURCE_URL = 'https://japan-pointcloud.s3.ap-northeast-1.amazonaws.com/Tokyo/2023/01/LP/Original/LAS/09/QC/17/09QC1711.zip'
CAPS = dict(source_points=12000000, roi_points=1000000, output_vertices=1500000,
            output_triangles=3000000, member_bytes=512*1024*1024, elapsed_seconds=180)
ROI = dict(x=[5785,5950], y=[0,165], z=[-1090,-940])

def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True, help='Must be a new directory')
    parser.add_argument('--dependency-path', action='append', type=Path, default=[],
                        help='Optional explicit user-supplied Python package directory; repeatable')
    args = parser.parse_args()
    if args.output.exists(): parser.error('Output already exists; use a new directory')
    if sha(args.source) != SOURCE_SHA: parser.error('Source ZIP SHA256 mismatch')
    for path in reversed(args.dependency_path):
        if not path.is_dir(): parser.error('Dependency directory does not exist')
        sys.path.insert(0, str(path))
    os.environ['OMP_NUM_THREADS']='2'
    os.environ['OPENBLAS_NUM_THREADS']='2'
    import numpy as np
    import laspy
    import pyproj
    import open3d as o3d
    from scipy.spatial import cKDTree
    if o3d.__version__ != '0.19.0': raise RuntimeError('Requires exact Open3D 0.19.0')
    started=time.perf_counter()
    def budget():
        if time.perf_counter()-started > CAPS['elapsed_seconds']:
            raise RuntimeError('Elapsed budget exceeded; no further processing')
    transformer=pyproj.Transformer.from_crs(6677,4326,always_xy=True)
    points=[];colors=[];source_count=0;selected_count=0
    with zipfile.ZipFile(args.source) as archive:
        info=archive.getinfo('09QC1711.las')
        if info.file_size > CAPS['member_bytes']: raise RuntimeError('LAS member byte budget exceeded')
        with archive.open(info) as stream, laspy.open(stream) as reader:
            header=reader.header
            if str(header.version) != '1.2' or header.point_format.id != 3:
                raise RuntimeError('Unexpected original LAS version/point format')
            if header.point_count > CAPS['source_points']: raise RuntimeError('Source point cap exceeded')
            if header.point_count != 10853673: raise RuntimeError('Approved original source point count differs')
            for chunk in reader.chunk_iterator(500000):
                budget();source_count+=len(chunk)
                selected=(np.asarray(chunk.classification)==2)&~np.asarray(chunk.withheld,dtype=bool)
                lon,lat=transformer.transform(np.asarray(chunk.x)[selected],np.asarray(chunk.y)[selected])
                x=(lon-139.2117451)*111320*math.cos(math.radians(34.3359808))
                z=(34.3359808-lat)*111320;y=np.asarray(chunk.z)[selected]
                roi=(x>=5785)&(x<=5950)&(z>=-1090)&(z<=-940)&(y>=0)&(y<=165)
                selected_count+=int(roi.sum())
                if selected_count > CAPS['roi_points']: raise RuntimeError('ROI point cap exceeded')
                points.append(np.column_stack((x[roi],y[roi],z[roi])))
                colors.append(np.column_stack([np.asarray(getattr(chunk,k))[selected][roi] for k in ('red','green','blue')]))
    xyz=np.concatenate(points);rgb=np.concatenate(colors).astype(float)/65535
    if not np.isfinite(xyz).all(): raise RuntimeError('Nonfinite observations')
    xyz,indices=np.unique(xyz,axis=0,return_index=True);rgb=rgb[indices]
    cloud=o3d.geometry.PointCloud();cloud.points=o3d.utility.Vector3dVector(xyz);cloud.colors=o3d.utility.Vector3dVector(rgb)
    cloud.estimate_normals(o3d.geometry.KDTreeSearchParamHybrid(radius=2,max_nn=30))
    cloud.orient_normals_consistent_tangent_plane(30)
    normals=np.asarray(cloud.normals);horizontal=np.abs(normals[:,1])>=.7
    if not horizontal.any(): raise RuntimeError('Missing near-horizontal normal anchors')
    anchor=float(np.median(normals[horizontal,1]));flipped=anchor<0
    if flipped: cloud.normals=o3d.utility.Vector3dVector(-normals)
    budget()
    mesh,density=o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(cloud,depth=9,n_threads=2)
    budget()
    if len(mesh.vertices)>CAPS['output_vertices'] or len(mesh.triangles)>CAPS['output_triangles']:
        raise RuntimeError('Mesh output cap exceeded')
    density=np.asarray(density);threshold=float(np.quantile(density,.05));tree=cKDTree(xyz)
    args.output.mkdir(parents=True,exist_ok=False)
    artifacts={}
    def save(m,name,d):
        budget();v=np.asarray(m.vertices);t=np.asarray(m.triangles);distance,nearest=tree.query(v,workers=2)
        m.vertex_colors=o3d.utility.Vector3dVector(rgb[nearest]);m.compute_vertex_normals()
        ply=args.output/(name+'.ply')
        if not o3d.io.write_triangle_mesh(str(ply),m): raise RuntimeError('PLY write failed')
        origin=[5880.,0.,-1015.]
        buffers={}
        arrays={'position':((v-origin).astype('<f4'),'Float32',3),'index':(t.astype('<u4'),'Uint32',3),
                'normal':(np.asarray(m.vertex_normals).astype('<f4'),'Float32',3),
                'color':(np.asarray(m.vertex_colors).astype('<f4'),'Float32',3),
                'density':(d.astype('<f4'),'Float32',1),'observationDistance':(distance.astype('<f4'),'Float32',1),
                'inferredRegion':((distance>1).astype('u1'),'Uint8',1),'lowDensityRegion':((d<threshold).astype('u1'),'Uint8',1)}
        for key,(array,dtype,components) in arrays.items():
            file=args.output/(name+'-'+key+'.bin');array.tofile(file)
            buffers[key]={'file':file.name,'type':dtype,'components':components,'count':len(array),'bytes':file.stat().st_size,'sha256':sha(file)}
            artifacts[file.name]=sha(file)
        descriptor={'version':1,'origin':origin,'coordinates':'SEA x,y up,z along coast; meters; relative positions + origin','endianness':'little','vertices':len(v),'triangles':len(t),'buffers':buffers}
        file=args.output/(name+'-buffers.json');file.write_text(json.dumps(descriptor,indent=2)+'\n',encoding='utf-8');artifacts[file.name]=sha(file);artifacts[ply.name]=sha(ply)
        _,counts,_=m.cluster_connected_triangles()
        edges=np.sort(np.vstack([t[:,[0,1]],t[:,[1,2]],t[:,[2,0]]]),axis=1);_,ec=np.unique(edges,axis=0,return_counts=True)
        return {'vertices':len(v),'triangles':len(t),'components':len(counts),'bboxMin':v.min(0).tolist(),'bboxMax':v.max(0).tolist(),'watertight':m.is_watertight(),'boundaryEdges':int((ec==1).sum()),'distanceP50P95P99MaxM':np.quantile(distance,[.5,.95,.99,1]).tolist(),'distanceAbove1mFraction':float((distance>1).mean()),'lowDensityFraction':float((d<threshold).mean())}
    raw=save(mesh,'poisson-raw',density)
    v=np.asarray(mesh.vertices);keep=(v[:,0]>=5785)&(v[:,0]<=5950)&(v[:,1]>=0)&(v[:,1]<=165)&(v[:,2]>=-1090)&(v[:,2]<=-940)
    cropped=o3d.geometry.TriangleMesh(mesh);cropped.remove_vertices_by_mask(~keep)
    crop=save(cropped,'poisson-cropped-only',density[keep])
    vertices=np.asarray(cropped.vertices);triangles=np.asarray(cropped.triangles)
    packed=args.output/'packedsource.bin'
    positions=(vertices-[5880.,0.,-1015.]).astype('<f4');indices=triangles.astype('<u4')
    with packed.open('wb') as stream:
        stream.write(positions.tobytes());stream.write(indices.tobytes())
    descriptor={'version':1,'origin':[5880,0,-1015],'vertices':len(vertices),'triangles':len(triangles),'positions':{'type':'Float32','components':3,'offsetBytes':0,'count':len(vertices),'bytes':positions.nbytes},'indices':{'type':'Uint32','components':3,'offsetBytes':positions.nbytes,'count':len(triangles),'bytes':indices.nbytes},'file':packed.name,'bytes':packed.stat().st_size,'sha256':sha(packed),'endianness':'little'}
    descriptor_path=args.output/'packedsource.json';descriptor_path.write_text(json.dumps(descriptor,indent=2)+'\n',encoding='utf-8')
    artifacts[packed.name]=sha(packed);artifacts[descriptor_path.name]=sha(descriptor_path)
    edges=np.sort(np.vstack([triangles[:,[0,1]],triangles[:,[1,2]],triangles[:,[2,0]]]),axis=1)
    unique_edges,edge_counts=np.unique(edges,axis=0,return_counts=True);boundary=unique_edges[edge_counts==1]
    near_planes={}
    for axis,name,low,high in [(0,'x',5785,5950),(1,'y',0,165),(2,'z',-1090,-940)]:
        for value in [low,high]:
            near=np.abs(vertices[:,axis]-value)<0.5
            near_planes[f'{name}={value}']={'verticesWithin0.5m':int(near.sum()),'boundaryEdgesBothEndpointsWithin0.5m':int(near[boundary].all(1).sum())}
    crop['cropPlaneDiagnostics']=near_planes
    receipt={'source':SOURCE_URL,'sourceSha256':SOURCE_SHA,'sourceMember':'09QC1711.las','sourcePoints':source_count,
             'sourceLASVersion':str(header.version),'sourcePointFormat':header.point_format.id,
             'sourceCRS':'EPSG6677 per catalogue; not inferred from absent LAS VLR','transformAccuracyM':transformer.accuracy,
             'coordinateTransform':{'referenceLongitude':139.2117451,'referenceLatitude':34.3359808,'metersPerDegree':111320,'x':'(longitude-referenceLongitude)*metersPerDegree*cos(referenceLatitude)','y':'original LAS elevation','z':'(referenceLatitude-latitude)*metersPerDegree'},
             'roi':ROI,'roiPoints':selected_count,'uniquePoints':len(xyz),'inputBBoxMin':xyz.min(0).tolist(),'inputBBoxMax':xyz.max(0).tolist(),
             'open3dVersion':o3d.__version__,'normalRadiusM':2,'normalMaxNN':30,'normalMSTNeighbors':30,
             'normalSign':'One global flip toward +Y using median Y of abs(normalY)>=0.7; no per-point forcing',
             'normalAnchorCount':int(horizontal.sum()),'normalAnchorMedianBeforeFlip':anchor,'globalNormalFlip':bool(flipped),
             'poissonDepth':9,'threads':2,'densityLabelQuantile':.05,'densityThreshold':threshold,'densityRemoval':False,
             'raw':raw,'croppedOnly':crop,'caps':CAPS,'elapsedSeconds':time.perf_counter()-started,
             'credit':'Tokyo Metropolitan Government Digital Service Bureau','license':'CC-BY-4.0','licenseURL':'https://creativecommons.org/licenses/by/4.0/',
             'methodReferences':['https://www.open3d.org/docs/release/tutorial/geometry/surface_reconstruction.html','https://github.com/isl-org/Open3D/blob/v0.19.0/cpp/open3d/geometry/SurfaceReconstructionPoisson.cpp'],
             'scriptSha256':sha(Path(__file__)),'artifacts':artifacts,
             'limits':['Poisson is inferred surface reconstruction, including unobserved sidewalls; not measured accuracy or photorealism','Global upward normal anchor does not verify sidewall outward normals','Distance>1m and bottom5% density are diagnostic labels, not a truth boundary','Crop removes out-of-ROI vertices and their triangles only; no density removal','No runtime integration, collision acceptance, or automatic downloads','Budgets bound input/output and check elapsed time between stages; native calls are not forcibly interrupted']}
    (args.output/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(receipt,indent=2))

if __name__=='__main__': main()
