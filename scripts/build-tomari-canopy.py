"""Tokyo CC BY4.0 inferred canopy clumps. Requires numpy/scipy/laspy/tifffile/pyproj. Source archives must be obtained after reviewing provider terms. No network access."""
from pathlib import Path
import sys,io,zipfile,json,math,hashlib,argparse
import numpy as np,laspy,tifffile,pyproj
from scipy.ndimage import map_coordinates
parser=argparse.ArgumentParser();parser.add_argument('--archive',type=Path,required=True);parser.add_argument('--grid',type=Path,required=True);parser.add_argument('--verify',action='store_true');args=parser.parse_args()
archive=args.archive
assert hashlib.sha256(archive.read_bytes()).hexdigest()=='50a4a789301282ef04da7c1e5165ac8e9b7f74b3b23b5e75b69838457ca0cd35'
assert hashlib.sha256(args.grid.read_bytes()).hexdigest()=='1b766ace1472e0d2722ae251aaf33215c43e3c8ea5a855ac43ef00a1ad7ba386'
with zipfile.ZipFile(archive) as z:cloud=laspy.read(io.BytesIO(z.read('09QC1546.las')))
e=np.asarray(cloud.x);n=np.asarray(cloud.y);h=np.asarray(cloud.z);classes=np.asarray(cloud.classification)
t=pyproj.Transformer.from_crs(6677,4326,always_xy=True);lon,lat=t.transform(e,n);x=(lon-139.2117451)*111320*math.cos(math.radians(34.3359808));z=(34.3359808-lat)*111320
bounds={'minX':-242,'maxX':-60,'minZ':-100,'maxZ':61}
mask=(x>bounds['minX'])&(x<bounds['maxX'])&(z>bounds['minZ'])&(z<bounds['maxZ'])&(classes==1)
r=np.asarray(cloud.red)[mask].astype(float);g=np.asarray(cloud.green)[mask].astype(float);b=np.asarray(cloud.blue)[mask].astype(float)
e=e[mask];n=n[mask];h=h[mask];x=x[mask];z=z[mask]
with zipfile.ZipFile(args.grid) as zz:dem=tifffile.imread(io.BytesIO(zz.read('09QC1546.tif')))
ground=map_coordinates(dem,[(-184200-n)/.25-.5,(e+57600)/.25-.5],order=1,mode='nearest')
valid=(g>r*1.08)&(g>b*1.12)&(h-ground>.7)&(h-ground<12)&(ground>6)
x=x[valid];z=z[valid];h=h[valid];ground=ground[valid]
size=3.5;cols=np.floor((x-bounds['minX'])/size).astype(int);rows=np.floor((z-bounds['minZ'])/size).astype(int);ids=rows*1000+cols;order=np.argsort(ids);groups=np.split(order,np.flatnonzero(np.diff(ids[order]))+1)
plants=[]
for indices in groups:
 if len(indices)<35:continue
 xx=x[indices];zz=z[indices];top=float(np.percentile(h[indices],85));base=float(np.percentile(ground[indices],50));height=top-base
 spreadx=float(np.percentile(xx,95)-np.percentile(xx,5));spreadz=float(np.percentile(zz,95)-np.percentile(zz,5))
 if height<1.2 or height>11 or min(spreadx,spreadz)<.65:continue
 plants.append([round(float(np.median(xx)),3),round(float(np.median(zz)),3),round(top,3),round(base,3),round(spreadx,3),round(spreadz,3),len(indices)])
meta={'id':'tokyo-tomari-canopy-inference-v59','bounds':bounds,'sourceZipSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'source':'Tokyo 09QC1546 LAS / CC BY4.0','method':'Source class1 + green-dominant RGB, 0.7..12m above provider DEM; robust envelope in 3.5m bins. These are inferred canopy clumps, NOT measured tree stems, species or individual count.','columns':['x','z','observedTop','demGroundMedian','spreadX','spreadZ','sourcePoints'],'points':int(valid.sum()),'count':len(plants),'plants':plants}
target=Path(__file__).resolve().parents[1]/'src/world/tomari-canopy.generated.ts';rendered=('/** Inferred canopy envelopes from Tokyo CC BY4.0 coloured points; not surveyed stems. */\nexport const TOMARI_CANOPY = '+json.dumps(meta,ensure_ascii=False,separators=(',',':'))+' as const;\n')
if args.verify:assert target.read_text(encoding='utf-8')==rendered,'Canopy derivative differs'
else:target.write_text(rendered,encoding='utf-8')
print(json.dumps({'count':len(plants),'points':int(valid.sum()),'heights':np.percentile([p[2]-p[3] for p in plants],[10,50,90]).tolist()}))
