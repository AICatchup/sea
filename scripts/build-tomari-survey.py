"""Tokyo CC BY 4.0 Tomari west DEM derivative. Requires numpy, tifffile, pyproj, scipy.
Reprojection onto SEA's quarter-coast-cell lattice is explicit; not native topology or cm accuracy.
Pass a locally obtained archive after accepting the provider terms. No network access here.
"""
from pathlib import Path
import argparse,hashlib,io,zipfile,json,base64,math
import numpy as np,tifffile,pyproj
from scipy.ndimage import map_coordinates
p=argparse.ArgumentParser();p.add_argument('--archive',type=Path,required=True);p.add_argument('--verify',action='store_true');args=p.parse_args()
raw=args.archive.read_bytes();assert hashlib.sha256(raw).hexdigest()=='1b766ace1472e0d2722ae251aaf33215c43e3c8ea5a855ac43ef00a1ad7ba386'
with zipfile.ZipFile(io.BytesIO(raw)) as archive:tiff=archive.read('09QC1546.tif')
assert hashlib.sha256(tiff).hexdigest()=='8cfa80ab355a0f85aa25c4acd38361557e75cbf3b7856a1c04eb286da437b521'
with tifffile.TiffFile(io.BytesIO(tiff)) as f:
 a=f.asarray();tags=f.pages[0].tags
 assert a.shape==(1200,1600) and tags[33550].value==(.25,.25,0.) and tags[33922].value==(0.,0.,0.,-57600.,-184200.,0.)
# Exact bounds coincide with existing 1m/0.5m Tomari cells; retain a seam band.
dx=.9862144539255815;dz=.9862084580266731
minx=-298.91765416352035+48*dx;minz=-273.7217431740901+160*dz
width=208*4+1;height=192*4+1
j,i=np.indices((height,width));x=minx+i*dx/4;z=minz+j*dz/4
tr=pyproj.Transformer.from_crs(4326,6677,always_xy=True)
e,n=tr.transform(139.2117451+x/(111320*math.cos(math.radians(34.3359808))),34.3359808-z/111320)
c=(e+57600)/.25-.5;r=(-184200-n)/.25-.5
valid=np.isfinite(a)&(a>-327)&(a<327)
support=map_coordinates(valid.astype(float),[r,c],order=1,mode='constant',cval=0)
y=map_coordinates(np.where(valid,a,0),[r,c],order=1,mode='constant',cval=0)
ok=support>.999999;encoded=np.where(ok,np.rint(y*100),-32768).astype('<i2');payload=encoded.tobytes()
meta={'id':'tomari-west-tokyo-09QC1546','width':width,'height':height,'origin':{'x':minx,'z':minz},'column':{'x':dx/4,'z':0},'row':{'x':0,'z':dz/4},'nativeSpacingMetres':.25,'runtimeReprojected':True,'validSamples':int(ok.sum()),'sourceURL':'https://japan-pointcloud.s3.ap-northeast-1.amazonaws.com/Tokyo/2023/01/LP/Grid/TIFF/09/QC/15/09QC1546.zip','sourceZipSha256':hashlib.sha256(raw).hexdigest(),'sourceTiffSha256':hashlib.sha256(tiff).hexdigest(),'heightsSha256':hashlib.sha256(payload).hexdigest(),'license':'CC BY 4.0','attribution':'東京都デジタルツイン実現プロジェクト 島しょ地域点群データを加工して作成','sourceCRS':'EPSG:6677 / PixelIsArea centres; legacy geographic citation says JGD2000 but projected GeoKey declares JGD2011','datumTransformAccuracyMetres':tr.accuracy,'maximumEncodingErrorMetres':float(abs(encoded*.01-y)[ok].max()),'centimetreSurveyAccuracyEstablished':False,'recording':'Bilinear reprojection of provider 25cm terrain onto SEA aligned ~24.66cm lattice. Runtime blends seams and unmeasured/low tidal ground to prior terrain. No measured overhang or plant inventory claim.'}
data={**meta,'heightsCentimetres':base64.b64encode(payload).decode()}
target=Path(__file__).resolve().parents[1]/'src/world/tomari-survey.generated.ts'
rendered='/** Tokyo CC BY4.0, reprojected 25cm DEM. Do not print the encoded payload. */\nexport const TOMARI_SURVEY = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+' as const;\n'
if args.verify:assert target.read_text(encoding='utf-8')==rendered
else:target.write_text(rendered,encoding='utf-8')
print(json.dumps(meta,ensure_ascii=False))
