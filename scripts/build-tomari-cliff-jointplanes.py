import bpy,bmesh,json,math,time,hashlib,random
from pathlib import Path
from mathutils import Vector,geometry
from mathutils.bvhtree import BVHTree
import argparse,sys
parser=argparse.ArgumentParser(description='Build inferred Tomari west cliff relief from bundled CC0 scans and pinned DEM samples.')
parser.add_argument('--output',required=True);parser.add_argument('--context')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
repo=Path(__file__).resolve().parents[1];run=Path(args.output).resolve();run.mkdir(parents=True,exist_ok=True)
context=Path(args.context) if args.context else repo/'scripts/geometry/tomari-west-context.json'
data=json.loads(context.read_text(encoding='utf-8'));grid=data['grid'];started=time.time()
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def smooth(a,b,x):
 t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
def height(x,z):
 px=max(0,min(grid['nx']-1.001,(x-grid['minX'])/grid['step']));pz=max(0,min(grid['nz']-1.001,(z-grid['minZ'])/grid['step']));ix,iz=int(px),int(pz);tx,tz=px-ix,pz-iz;i=iz*grid['nx']+ix;h=grid['heights'];return (h[i]*(1-tx)+h[i+1]*tx)*(1-tz)+(h[i+grid['nx']]*(1-tx)+h[i+grid['nx']+1]*tx)*tz
def face_x(y,z):
 for i in range(grid['nx']-1,-1,-1):
  x=grid['minX']+i*grid['step']
  if height(x,z)>=y:
   lo,hi=x,x+grid['step']
   for _ in range(9):
    mid=(lo+hi)/2
    if height(mid,z)>=y:lo=mid
    else:hi=mid
   return (lo+hi)/2
 return grid['minX']-2
fields=[];sources=[]
for name in ['coast-rocks-01-2k.glb','coast-rocks-03-2k.glb','boulder-01-2k.glb','namaqualand-boulder-02-2k.glb','namaqualand-boulder-03-2k.glb']:
 source=repo/'src/assets/marine'/name;before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(source));objects=[o for o in bpy.data.objects if o not in before];meshes=[o for o in objects if o.type=='MESH'];obj=meshes[0];bm=bmesh.new();bm.from_mesh(obj.data);bm.transform(obj.matrix_world)
 lo=Vector([min(v.co[k] for v in bm.verts) for k in range(3)]);hi=Vector([max(v.co[k] for v in bm.verts) for k in range(3)]);centre=(lo+hi)*.5;span=hi-lo
 fields.append((BVHTree.FromBMesh(bm),lo,hi,centre,span));bm.free();sources.append({'asset':name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'role':'physical scan relief sampled along measured scan up axis; inferred vertical cliff placement'})
 for o in objects:bpy.data.objects.remove(o,do_unlink=True)
def scan(k,u,v):
 bvh,lo,hi,c,s=fields[k];x=c.x+u*s.x;q=c.y+v*s.y
 hit=bvh.ray_cast(Vector((x,q,hi.z+1)),Vector((0,0,-1)),s.z+2)[0]
 return max(0,(hit.z-lo.z)/s.z) if hit is not None else 0

# Irregular fracture cells have unequal size, angle, relief and physical scan.
rng=random.Random(3207);cells=[]
for row in range(8):
 for col in range(15):
  cells.append((-47+col*5.4+rng.uniform(-2,2),-2+row*4.7+rng.uniform(-1.5,1.5),rng.uniform(4.8,8.1),rng.uniform(3.8,6.2),rng.uniform(0,math.tau),rng.randrange(2,5),rng.uniform(.45,1.0)))
# An inverse-DEM face, not scattered attached boulders. All six perimeter faces
# are closed and buried; the photographed rock's relief changes actual geometry.
# Unequal open-ended joint wedges. Each supported ridge is the minimum of
# affine planes, with clipped corners; there are no radial cell centres/rims.
wedges=[(-29,10,7.4,5.2,.94,.13),(-21,16,8.2,6.3,1.20,-.18),
 (-13,9,6.8,4.9,.82,.23),(-9,19,8.5,5.1,1.10,.11),
 (-1,13,7.2,6.4,1.15,-.21),(8,17,7.8,5.5,.99,.19),(12,8,5.2,4.0,.75,-.13)]
def joint_relief(z,y):
 planes=[]
 for cz,cy,w,h,r,tilt in wedges:
  u=z-cz;v=y-cy;u,v=u+tilt*v,v-tilt*u
  # Asymmetric support planes and one diagonal clipped shoulder.
  planes.append(max(0,min(r+.15*u,r-.25*u,r+.23*v,r-.32*v,
   (u+w)*.36,(w-u)*.42,(v+h)*.38,(h-v)*.45,r+.14*u-.16*v)))
 relief=max(planes)
 # Three sparse branched joints only, terminating inside the patch. Their
 # narrow bevel strips do not outline every wedge as a closed polygon tile.
 for za,ya,zb,yb,depth in [(-26,7,-18,20,.32),(-18,20,-9,22,.20),(-18,20,-11,13,.26),(-5,6,5,19,.30),(5,19,11,20,.18)]:
  dx,dy=zb-za,yb-ya;t=max(0,min(1,((z-za)*dx+(y-ya)*dy)/(dx*dx+dy*dy)))
  dist=math.hypot(z-(za+t*dx),y-(ya+t*dy))
  relief-=depth*max(0,1-dist/.28)*min(1,t*10,(1-t)*10)
 return max(.10,relief)
z0,z1=-44,26;y0,y1=1.7,29.0;nz,ny=281,111;verts=[];backverts=[];maxrelief=0
for iz in range(nz):
 z=z0+(z1-z0)*iz/(nz-1)
 cap=min(y1,max(height(grid['minX']+i*grid['step'],z) for i in range(grid['nx']))-1.3)
 for iy in range(ny):
  y=y0+(cap-y0)*iy/(ny-1);base=face_x(y,z)
  u=(z+9)/83;v=(y-15)/48
  h1=scan(0,u,v);u2=(z+13)/55;v2=(y-14)/39
  h2=scan(1,u2*.90-v2*.22,u2*.22+v2*.90)
  blend=smooth(-14,16,z);macro=(1-blend)*h1+blend*h2
  ranked=sorted(((math.hypot((z-c[0])*.9,y-c[1]),c) for c in cells),key=lambda q:q[0]);near,second=ranked[:2];c=near[1]
  du,dv=(z-c[0])/c[2],(y-c[1])/c[3];co,si=math.cos(c[4]),math.sin(c[4]);local=scan(c[5],du*co-dv*si,du*si+dv*co)
  c2=second[1];du2,dv2=(z-c2[0])/c2[2],(y-c2[1])/c2[3];co2,si2=math.cos(c2[4]),math.sin(c2[4]);other=scan(c2[5],du2*co2-dv2*si2,du2*si2+dv2*co2)
  edge=second[0]-near[0];weight=.5+.5*smooth(0,1.0,edge);local=local*weight+other*(1-weight)
  # Only one facing sector carries a narrow joint. Closed equal-depth cell rims
  # make rock look like folded rubber, so the other borders blend scan relief.
  sector=smooth(.25,.75,math.cos(math.atan2(y-c[1],z-c[0])-c[4]))
  fracture=.18*(1-smooth(.05,.48,edge))*sector
  original=.10+.34*macro+.66*local-fracture
  patch=smooth(-34,-30,z)*(1-smooth(13,17,z))*smooth(5,7,y)*(1-smooth(21,23,y))
  relief=original*(1-patch)+(joint_relief(z,y)+.12*local)*patch
  lower=2.0+.5*math.sin(z*.19)+.25*math.sin(z*.67)
  taper=smooth(lower,lower+7.0,y)*(1-smooth(cap-7,cap,y))*smooth(z0,z0+8,z)*(1-smooth(z1-8,z1,z))
  # If this level lies above the local island, the entire face stays buried/hidden.
  taper*=smooth(grid['minX']+1,grid['minX']+6,base)
  offset=-.55+(relief+.55)*taper;maxrelief=max(maxrelief,offset)
  fx=base+offset;fy=min(y,height(fx,z)-1.6) if taper<.04 else y
  verts.append((fx,-z,fy))
  bx=base-1.1;backverts.append((bx,-z,min(fy-.10,height(bx,z)-2.2)))
n=len(verts);verts += backverts;faces=[]
for iz in range(nz-1):
 for iy in range(ny-1):
  a=iz*ny+iy;b=a+1;c=a+ny;d=c+1
  faces.extend([(a,c,d),(a,d,b),(a+n,d+n,c+n),(a+n,b+n,d+n)])
border=list(range(ny))+[iz*ny+ny-1 for iz in range(1,nz)]+list(range((nz-1)*ny+ny-2,(nz-1)*ny-1,-1))+[iz*ny for iz in range(nz-2,0,-1)]
for i,a in enumerate(border):
 b=border[(i+1)%len(border)];faces.extend([(a,b,b+n),(a,b+n,a+n)])
mesh=bpy.data.meshes.new('inverse DEM with two scan reliefs');mesh.from_pydata(verts,[],faces);mesh.update();obj=bpy.data.objects.new('Tomari connected fractured west wall',mesh);bpy.context.collection.objects.link(obj);obj['recon_part']='west-crag-volume'
# Target changed front vs buried back with real segment/triangle intersection,
# and confirm the changed face remains an injective graph in (z,y).
front_faces=[f for f in faces if all(i<n for i in f) and all(-34<-verts[i][1]<17 and 5<verts[i][2]<23 for i in f)]
back_faces=[f for f in faces if all(i>=n for i in f)]
fv=[Vector(v) for v in verts]
front_bvh=BVHTree.FromPolygons(fv,front_faces,all_triangles=True);back_bvh=BVHTree.FromPolygons(fv,back_faces,all_triangles=True)
possible=front_bvh.overlap(back_bvh);intersections=0
def segment_hit(a,b,tri):
 hit=geometry.intersect_ray_tri(*tri,b-a,a,True)
 return hit is not None and (hit-a).length<=(b-a).length+1e-7
for fi,bi in possible:
 aa=[fv[i] for i in front_faces[fi]];bb=[fv[i] for i in back_faces[bi]]
 if any(segment_hit(aa[k],aa[(k+1)%3],bb) or segment_hit(bb[k],bb[(k+1)%3],aa) for k in range(3)):intersections+=1
assert intersections==0
assert all(verts[iz*ny+iy+1][2]>verts[iz*ny+iy][2] for iz in range(nz) for iy in range(ny-1) if -34<-verts[iz*ny+iy][1]<17 and 5<verts[iz*ny+iy][2]<23)
bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh)
result={'kind':'V69 inferred unequal joint-plane wedges with sparse branched bevels; V32 perimeter and DEM guards','patch_zy':[-34,17,5,23],'wedges':wedges,'triangles':len(bm.faces),'vertices':len(bm.verts),'boundary_edges':sum(e.is_boundary for e in bm.edges),'nonmanifold_edges':sum(not e.is_manifold for e in bm.edges),'degenerate_faces':sum(f.calc_area()<1e-10 for f in bm.faces),'finite':all(math.isfinite(c) for v in bm.verts for c in v.co),'max_outward_offset_m':maxrelief,'min_front_back_x_gap_m':min(verts[i][0]-verts[i+n][0] for i in range(n)),'bounds_world':{'min':[min(v[0] for v in verts),min(v[2] for v in verts),min(-v[1] for v in verts)],'max':[max(v[0] for v in verts),max(v[2] for v in verts),max(-v[1] for v in verts)]},'sources':sources};bm.free()
result['targeted_intersection']={'changed_front_faces':len(front_faces),'back_faces':len(back_faces),'aabb_pairs':len(possible),'segment_triangle_intersections':intersections,'front_y_injective':True,'scope':'changed interior front/back; original guard points checked separately'}
assert not result['boundary_edges'] and not result['nonmanifold_edges'] and not result['degenerate_faces'] and result['finite'];assert not mesh.validate(clean_customdata=False)
for p in mesh.polygons:p.use_smooth=True
mesh.set_sharp_from_angle(angle=.45)
result['normal_policy']='smooth scan/plane interiors; split at adjacent face angle > 0.45 radians'
material=bpy.data.materials.new('Diagnostic grey; runtime world rock PBR');material.diffuse_color=(.37,.39,.40,1);material.use_nodes=True;next(n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED').inputs['Roughness'].default_value=.87;obj.data.materials.append(material)
world=bpy.context.scene.world;world.use_nodes=True;next(n for n in world.node_tree.nodes if n.type=='BACKGROUND').inputs[0].default_value=(.27,.34,.45,1);next(n for n in world.node_tree.nodes if n.type=='BACKGROUND').inputs[1].default_value=.4
light=bpy.data.lights.new('diagnostic sun','SUN');light.energy=2.8;sun=bpy.data.objects.new('diagnostic sun',light);bpy.context.collection.objects.link(sun);sun.rotation_euler=(.55,-.45,-.6)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=12;scene.render.resolution_x=960;scene.render.resolution_y=540;scene.render.resolution_percentage=100
# Remove unused imported datablocks from this generated scene before saving;
# the source GLBs and their photographed PBR maps remain untouched on disk.
for _ in range(3):
 for collection in [bpy.data.meshes,bpy.data.materials,bpy.data.images]:
  for block in list(collection):
   if block.users==0:collection.remove(block)
bpy.ops.wm.save_as_mainfile(filepath=str(run/'model.blend'));bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
bpy.ops.export_scene.gltf(filepath=str(run/'model.glb'),export_format='GLB',use_selection=True,export_cameras=False,export_lights=False)
back=bpy.data.scenes.new('face GLB readback');bpy.context.window.scene=back;bpy.ops.import_scene.gltf(filepath=str(run/'model.glb'));o=next(o for o in back.objects if o.type=='MESH');bm=bmesh.new();bm.from_mesh(o.data)
# GLTF duplicates positions at normal discontinuities. Test geometric closure
# after welding those positions, while preserving the exported split normals.
result['readback_export_vertices']=len(bm.verts)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
result['readback']={'triangles':len(bm.faces),'boundary_edges':sum(e.is_boundary for e in bm.edges),'nonmanifold_edges':sum(not e.is_manifold for e in bm.edges)};bm.free();result['elapsed_seconds']=time.time()-started
(run/'build-result.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result),flush=True)
assert result['readback']['triangles']==result['triangles'] and not result['readback']['boundary_edges'] and not result['readback']['nonmanifold_edges']
