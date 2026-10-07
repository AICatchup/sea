"""Reproduce the CC BY4.0 Tokyo native-grid derivative.
Dependencies: numpy, tifffile, pyproj. Read provider terms before first download.
No source grid is smoothed or world-grid resampled. --verify compares exact bytes.
"""
from pathlib import Path
import argparse,sys,json,zipfile,io,math,base64,hashlib,urllib.request
import numpy as np,tifffile,pyproj
parser=argparse.ArgumentParser()
parser.add_argument('--archive',type=Path,help='Existing09QC1711-grid25.zip')
parser.add_argument('--verify',action='store_true')
args=parser.parse_args()
repo=Path(__file__).resolve().parents[1]
url='https://japan-pointcloud.s3.ap-northeast-1.amazonaws.com/Tokyo/2023/01/LP/Grid/TIFF/09/QC/17/09QC1711.zip'
expected_zip='89fefd0cfcd4484ea477bec98c6c4919a767b37a15d1220de389205447a77f47'
expected_tiff='517493120bf9952d641968a7e5dbd577eacbd9d5d9140c00133c10bb8185bf23'
if args.archive:
    content=args.archive.read_bytes()
else:
    raise SystemExit('Pass --archive after reviewing and obtaining the original under https://gic-tokyo.s3.ap-northeast-1.amazonaws.com/2023/dig/doc/license.pdf; source URL: '+url)
assert hashlib.sha256(content).hexdigest()==expected_zip,'Provider archive changed'
with zipfile.ZipFile(io.BytesIO(content)) as archive:raw_tiff=archive.read('09QC1711.tif')
assert hashlib.sha256(raw_tiff).hexdigest()==expected_tiff,'Provider TIFF changed'
source=tifffile.imread(io.BytesIO(raw_tiff));assert source.shape==(1200,1600)
c,r=np.meshgrid(np.linspace(0,1599,33),np.linspace(0,1199,25))
tr=pyproj.Transformer.from_crs(6677,4326,always_xy=True)
lon,lat=tr.transform(-51600+(c+.5)*.25,-183300-(r+.5)*.25)
x=(lon-139.2117451)*111320*math.cos(math.radians(34.3359808));z=(34.3359808-lat)*111320
A=np.column_stack([np.ones(c.size),c.ravel(),r.ravel()])
bx=np.linalg.lstsq(A,x.ravel(),rcond=None)[0];bz=np.linalg.lstsq(A,z.ravel(),rcond=None)[0]
frame={'basisX':bx.tolist(),'basisZ':bz.tolist()}
receipt={'url':url,'zipSha256':expected_zip,'tiffSha256':expected_tiff}
valid=np.isfinite(source)&(source<1e6)&(source>-327.67)&(source<327.67);encoded=np.where(valid,np.rint(source*100),-32768).astype('<i2')
r,c=np.indices(source.shape);lon,lat=tr.transform(-51600+(c+.5)*.25,-183300-(r+.5)*.25)
x=(lon-139.2117451)*111320*math.cos(math.radians(34.3359808));z=(34.3359808-lat)*111320
bx,bz=frame['basisX'],frame['basisZ'];ex=bx[0]+c*bx[1]+r*bx[2]-x;ez=bz[0]+c*bz[1]+r*bz[2]-z;ey=encoded.astype(np.float64)*.01-source
error=np.sqrt(ex*ex+ez*ez+ey*ey)
meta={'id':'tokyo-09QC1711-native','width':source.shape[1],'height':source.shape[0],'origin':{'x':bx[0],'z':bz[0]},'column':{'x':bx[1],'z':bz[1]},'row':{'x':bx[2],'z':bz[2]},'nativeGridSpacingMetres':.25,'catalogue':'https://www.geospatial.jp/ckan/dataset/tokyopc-shima-2023','sourceURL':receipt['url'],'sourceZipSha256':receipt['zipSha256'],'sourceTiffSha256':receipt['tiffSha256'],'license':'CC BY 4.0','attribution':'東京都デジタルツイン実現プロジェクト 島しょ地域点群データを加工して作成','sourceCRS':'EPSG6677; catalogue and projected GeoKey declare JGD2011, legacy geographic citation text says JGD2000','recording':'Provider-processed GeoTIFF values retained on their native pixel-centre topology; centimetre storage quantization. No global world-grid resampling. Native points are approximated by the documented local affine frame.','datumTransformAccuracyMetres':tr.accuracy,'numericalComparison':{'vertices':int(valid.sum()),'maximumHorizontalErrorMetres':float(np.hypot(ex,ez)[valid].max()),'maximumHeightEncodingErrorMetres':float(abs(ey[valid]).max()),'maximumVertexErrorMetres':float(error[valid].max()),'scope':'Against the declared transform of the provider grid, before seam blending or LOD. This excludes field survey and datum uncertainty and does NOT establish centimetre correspondence to reality.'},'centimetreSurveyAccuracyEstablished':False}
raw=encoded.tobytes();meta['heightsSha256']=hashlib.sha256(raw).hexdigest();data={**meta,'heightsCentimetres':base64.b64encode(raw).decode()}
target=repo/'src/world/niijima-survey-native.generated.ts'
rendered='/** Tokyo CC BY4.0 native25cm grid. Avoid printing the encoded height array. */\nexport const NIIJIMA_NATIVE_SURVEY = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+' as const;\n'
# Preserve the human-readable header already shipped; compare serialized data.
if args.verify:
    current=target.read_text(encoding='utf-8')
    actual=json.JSONDecoder().raw_decode(current.split('export const NIIJIMA_NATIVE_SURVEY =',1)[1].lstrip())[0]
    assert actual==data,'Regenerated native data differs; inspect dependency versions/coordinate transform'
else:target.write_text(rendered,encoding='utf-8')
print(json.dumps({'verified':args.verify,'sourceZipSha256':expected_zip,'nativeVertices':1920000,'numericalComparison':meta['numericalComparison']},ensure_ascii=False))
