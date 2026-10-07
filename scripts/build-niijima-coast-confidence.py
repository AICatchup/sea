# Requires Python 3, NumPy and Pillow. Original GSI bytes are never changed.
# Run: python scripts/build-niijima-coast-confidence.py --verify --cache-dir <cache>
from pathlib import Path
import argparse
parser=argparse.ArgumentParser(description='Reproduce the pinned DEM5/coarse source-seam repair')
parser.add_argument('--cache-dir',type=Path,default=Path(__file__).resolve().parents[1]/'work/coast-source-v40')
parser.add_argument('--verify',action='store_true')
args=parser.parse_args()
import math,json,hashlib,urllib.request,urllib.error,concurrent.futures,re,base64,numpy as np
from PIL import Image
repo=Path(__file__).resolve().parents[1];root=args.cache_dir.resolve();root.mkdir(parents=True,exist_ok=True)
raster_text=(repo/'src/world/niijima-detail-repaired.generated.ts').read_text(encoding='utf-8')
start=raster_text.index('=',raster_text.index('export const NIIJIMA_DETAIL_RASTER'))+1
raster_data,_=json.JSONDecoder().raw_decode(raster_text[start:].lstrip())
meta={key:raster_data[key] for key in ['width','height','minX','maxX','minZ','maxZ']}
generated=repo/'src/world/niijima-coast-confidence.generated.ts'
pinned_text=generated.read_text(encoding='utf-8')
pinned,_=json.JSONDecoder().raw_decode(pinned_text.split('export const NIIJIMA_COAST_CONFIDENCE =',1)[1].lstrip())
expected={entry['url']:entry['sha256'] for entry in pinned['sources']}
origin=(34.3359808,139.2117451);w,h=meta['width'],meta['height'];dx=(meta['maxX']-meta['minX'])/(w-1);dz=(meta['maxZ']-meta['minZ'])/(h-1)
def pixel(x,z):
 lon=origin[1]+x/(111320*math.cos(math.radians(origin[0])));lat=origin[0]-z/111320
 return (lon+180)/360*256*2**15,(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*256*2**15
px0,py0=map(round,pixel(meta['minX'],meta['minZ']))
jobs=[(layer,x,y) for layer in ['dem5a_png','dem5b_png'] for y in range(py0//256,(py0+h-1)//256+1) for x in range(px0//256,(px0+w-1)//256+1)]
def get(job):
 layer,x,y=job;url=f'https://cyberjapandata.gsi.go.jp/xyz/{layer}/15/{x}/{y}.png';path=root/f'{layer}-15-{x}-{y}.png'
 try:
  if path.exists():data=path.read_bytes()
  else:
   with urllib.request.urlopen(url,timeout=25) as f:data=f.read()
   path.write_bytes(data)
  digest=hashlib.sha256(data).hexdigest()
  if url in expected and digest!=expected[url]:raise ValueError(f'GSI source changed: {url}; review before replacing pinned data')
  return {'layer':layer,'x':x,'y':y,'url':url,'file':path.name,'sha256':digest,'status':200}
 except urllib.error.HTTPError as e:
  if e.code!=404:raise
  return {'layer':layer,'x':x,'y':y,'url':url,'status':e.code}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:receipts=list(pool.map(get,jobs))
fine=np.full((h,w),np.nan);choice=np.zeros((h,w),dtype=np.uint8)
for layer,code in [('dem5a_png',1),('dem5b_png',2)]:
 for t in receipts:
  if t['layer']!=layer or t['status']!=200:continue
  rgb=np.asarray(Image.open(root/t['file']).convert('RGB')).astype(np.int64);packed=rgb[...,0]*65536+rgb[...,1]*256+rgb[...,2]
  a=np.where(packed==8388608,np.nan,np.where(packed<8388608,packed,packed-16777216)/100)
  ix0,iz0=t['x']*256-px0,t['y']*256-py0;left,top=max(0,ix0),max(0,iz0);right,bottom=min(w,ix0+256),min(h,iz0+256)
  part=a[top-iz0:bottom-iz0,left-ix0:right-ix0];dest=fine[top:bottom,left:right];take=~np.isfinite(dest)&np.isfinite(part);dest[take]=part[take];choice[top:bottom,left:right][take]=code
text=(repo/'src/world/niijima-detail-repaired.generated.ts').read_text(encoding='utf-8');encoded=re.search(r'"elevations":\s*"([A-Za-z0-9+/=]+)"',text).group(1);raw=base64.b64decode(encoded);original=np.frombuffer(raw,dtype='<i2').reshape(h,w)
removed=[];rows=[]
for iz in range(h):
 valid=np.flatnonzero(np.isfinite(fine[iz]));
 if not len(valid):continue
 edge=int(valid[-1]);x=meta['minX']+edge*dx;level=float(fine[iz,edge]);z=meta['minZ']+iz*dz
 # Only the continuous eastern ocean-facing edge, anchored by fine coastal
 # elevations near mean sea level. An interior NA hole is never classified sea.
 if not(5500<x<6400 and -3<=level<=3 and edge+1<w):continue
 stop=edge+1
 while stop<w and original[iz,stop]!=-32768 and not math.isfinite(fine[iz,stop]):stop+=1
 if stop==edge+1:continue
 old=original[iz,edge+1:stop].astype(float)*.1
 # The coarse extension must actually contradict the near-zero finer edge.
 if old.max()<level+2:continue
 for ix in range(edge+1,stop):removed.append([iz*w+ix,int(original[iz,ix])])
 rows.append({'row':iz,'z':z,'fineEdgeX':x,'fineEdgeY':level,'cells':stop-edge-1,'maximumOldY':float(old.max())})
assert len(removed)>100,'Expected contradictory coastal fallback cells were not located; inspect sources'
fnv=2166136261
for byte in raw:fnv=((fnv^byte)*16777619)&0xffffffff
receipt={'retrieved':'2026-10-07','credit':'国土地理院の標高タイルを加工して作成','originalGridSha256':hashlib.sha256(raw).hexdigest(),'originalGridFnv1a':fnv,'width':w,'height':h,'minX':meta['minX'],'minZ':meta['minZ'],'dx':dx,'dz':dz,'changedCells':len(removed),'changedRows':len(rows),'rows':rows,'tiles':receipts,
 'rule':'Suppress only contiguous coarse-only ocean-facing extensions after a -3..3m valid DEM5 edge, when the extension rises >=2m above it. This coastal datum range includes observed -0.69m and 1.51m edge samples; the first narrower gate left false cliffs. Interior holes, finer samples and high cliff edges are preserved. Coast/sea interpretation checked against GSI orthophoto and official photographs; NA alone is not measured sea.',
 'scope':'Central Niijima source grid; new seafloor depths remain inferred, not surveyed. Acquisition date and tide are not established.'}
(root/'coast-confidence.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
public={k:v for k,v in receipt.items() if k not in ['rows','tiles']};public['sources']=[t for t in receipts if t['status']==200]
rendered=('/** Reproducible source-resolution seam corrections. Original source grid remains immutable. */\nexport const NIIJIMA_COAST_CONFIDENCE = '+json.dumps(public,ensure_ascii=False,indent=2)+' as const;\nexport const NIIJIMA_COARSE_SEA_CELLS: readonly (readonly [number,number])[] = '+json.dumps(removed,separators=(',',':'))+';\n')
if args.verify:
 assert rendered==pinned_text,'Regenerated patch differs; inspect new source choices and cells before accepting'
else:generated.write_text(rendered,encoding='utf-8')
np.savez(root/'confidence-arrays.npz',fine=fine,original=original,choice=choice,removed=np.array(removed,dtype=np.int32))
print(json.dumps({**{k:receipt[k] for k in ['changedCells','changedRows','originalGridSha256','originalGridFnv1a']},'zRange':[min(r['z'] for r in rows),max(r['z'] for r in rows)]},ensure_ascii=False))
