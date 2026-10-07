"""Reproduce two contiguous native25cm Tokyo tiles, preserving their shared lattice.
Dependencies: numpy, tifffile, pyproj. Source terms/license must be reviewed before obtaining archives.
"""
from pathlib import Path
import argparse,json,zipfile,io,math,base64,hashlib
import numpy as np,tifffile,pyproj
parser=argparse.ArgumentParser()
parser.add_argument('--north',type=Path,required=True)
parser.add_argument('--south',type=Path,required=True)
parser.add_argument('--verify',action='store_true')
args=parser.parse_args();repo=Path(__file__).resolve().parents[1]
specs=[
 {'id':'09QC1701','path':args.north,'northing':-183000.,'zipSha256':'0a82fad30bb148c54a990874b2bd535f6c5595c4e01177380348c00e8aef2909','tiffSha256':'f0046ebf015834b00b4889fa9cd2e11dfe6f9dce66f172aa7da0b65c6dcb24cb'},
 {'id':'09QC1711','path':args.south,'northing':-183300.,'zipSha256':'89fefd0cfcd4484ea477bec98c6c4919a767b37a15d1220de389205447a77f47','tiffSha256':'517493120bf9952d641968a7e5dbd577eacbd9d5d9140c00133c10bb8185bf23'}]
arrays=[];sources=[]
for s in specs:
    content=s['path'].read_bytes();assert hashlib.sha256(content).hexdigest()==s['zipSha256'],'Provider archive changed'
    with zipfile.ZipFile(io.BytesIO(content)) as archive:raw=archive.read(s['id']+'.tif')
    assert hashlib.sha256(raw).hexdigest()==s['tiffSha256'],'Provider TIFF changed'
    with tifffile.TiffFile(io.BytesIO(raw)) as t:
        tags=t.geotiff_metadata
        assert tags['ProjectedCSTypeGeoKey']==6677 and tags['GTRasterTypeGeoKey']==1
        assert tuple(tags['ModelPixelScale'][:2])==(.25,.25)
        assert tuple(tags['ModelTiepoint'][3:5])==(-51600.,s['northing'])
        a=t.asarray();assert a.shape==(1200,1600)
        assert (np.isfinite(a)&(abs(a)<327.67)).all(),'Unexpected missing/range data; retain it explicitly before import'
        arrays.append(a)
    sources.append({'id':s['id'],'url':'https://japan-pointcloud.s3.ap-northeast-1.amazonaws.com/Tokyo/2023/01/LP/Grid/TIFF/09/QC/17/'+s['id']+'.zip','zipSha256':s['zipSha256'],'tiffSha256':s['tiffSha256'],'nativeNorthing':s['northing'],'rows':1200,'columns':1600,'nativePixelMetres':.25})
# Rows are adjacent native sample centres; no duplicate seam, overlap or interpolation.
source=np.concatenate(arrays,axis=0);height,width=source.shape
tr=pyproj.Transformer.from_crs(6677,4326,always_xy=True)
c,r=np.meshgrid(np.linspace(0,width-1,33),np.linspace(0,height-1,49))
lon,lat=tr.transform(-51600+(c+.5)*.25,-183000-(r+.5)*.25)
x=(lon-139.2117451)*111320*math.cos(math.radians(34.3359808));z=(34.3359808-lat)*111320
A=np.column_stack([np.ones(c.size),c.ravel(),r.ravel()]);bx=np.linalg.lstsq(A,x.ravel(),rcond=None)[0];bz=np.linalg.lstsq(A,z.ravel(),rcond=None)[0]
rr,cc=np.indices(source.shape);lon,lat=tr.transform(-51600+(cc+.5)*.25,-183000-(rr+.5)*.25)
x=(lon-139.2117451)*111320*math.cos(math.radians(34.3359808));z=(34.3359808-lat)*111320
encoded=np.rint(source.astype(np.float64)*100).astype('<i2');ex=bx[0]+cc*bx[1]+rr*bx[2]-x;ez=bz[0]+cc*bz[1]+rr*bz[2]-z;ey=encoded.astype(np.float64)*.01-source
raw=encoded.tobytes()
meta={'id':'tokyo-09QC1701-1711-native','width':width,'height':height,'origin':{'x':bx[0],'z':bz[0]},'column':{'x':bx[1],'z':bz[1]},'row':{'x':bx[2],'z':bz[2]},'nativeGridSpacingMetres':.25,'catalogue':'https://www.geospatial.jp/ckan/dataset/tokyopc-shima-2023','sourceTiles':sources,'license':'CC BY 4.0','attribution':'東京都デジタルツイン実現プロジェクト 島しょ地域点群データを加工して作成','sourceCRS':'EPSG6677; catalogue and projected GeoKey declare JGD2011, legacy geographic citation says JGD2000','recording':'Two native25cm PixelIsArea grids joined in their shared EPSG6677 frame. Every source sample is retained; only its centimetre integer representation and documented local affine approximation change. No global resampling or seam smoothing.','datumTransformAccuracyMetres':tr.accuracy,'numericalComparison':{'vertices':int(source.size),'maximumHorizontalErrorMetres':float(np.hypot(ex,ez).max()),'maximumHeightEncodingErrorMetres':float(abs(ey).max()),'maximumVertexErrorMetres':float(np.sqrt(ex*ex+ez*ez+ey*ey).max()),'scope':'Against the declared transform of both provider grids, before outer-boundary blending. Excludes source survey and datum uncertainty; NOT physical centimetre accuracy.'},'centimetreSurveyAccuracyEstablished':False,'heightsSha256':hashlib.sha256(raw).hexdigest()}
data={**meta,'heightsCentimetres':base64.b64encode(raw).decode()}
target=repo/'src/world/niijima-survey-native.generated.ts'
rendered='/** Tokyo CC BY4.0 contiguous native25cm grids. Avoid printing encoded heights. */\nexport const NIIJIMA_NATIVE_SURVEY = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+' as const;\n'
if args.verify:
    current=json.JSONDecoder().raw_decode(target.read_text(encoding='utf-8').split('export const NIIJIMA_NATIVE_SURVEY =',1)[1].lstrip())[0]
    assert current==data,'Native span differs; inspect sources/dependency projection versions'
else:target.write_text(rendered,encoding='utf-8')
print(json.dumps({'verified':args.verify,'sourceTiles':[s['id'] for s in sources],'nativeSamples':source.size,'numericalComparison':meta['numericalComparison']},ensure_ascii=False))
