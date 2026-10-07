from pathlib import Path
import json, numpy as np
from PIL import Image

root=Path(__file__).resolve().parent
cases=json.loads((root/'comparisons.json').read_text(encoding='utf-8'))
assert len(cases)==7
results=[]
for group in cases:
    variants=group['variants'];name=variants[0]['name']
    for item in variants[1:]:
        for key in ['camera','pose','width','height','quality','preset','paused','locked']:
            assert variants[0]['state'][key]==item['state'][key],(name,key)
        assert variants[0]['time']==item['time']==34
        assert variants[0]['collision']==item['collision'] and variants[0]['worldSolids']==item['worldSolids']
    assert variants[0]['state']['width']==1280 and variants[0]['state']['height']==720
    a,b,c=[np.asarray(Image.open(root/f'{name}-{tag}.png').convert('RGB'),dtype=np.float64) for tag in ['before','candidate','return']]
    changed=np.max(abs(a-b),axis=-1)>2
    results.append({'name':name,'poseAndTimeMatched':True,'collisionStatsMatched':True,'changedPixelFraction':float(changed.mean()),
      'candidateWhiteClipFraction':float(np.all(b>=254,axis=-1).mean()),'baselineWhiteClipFraction':float(np.all(a>=254,axis=-1).mean()),
      'returnMeanAbsoluteDifference':float(abs(a-c).mean()),'candidateMeanRGBInChangedPixels':b[changed].mean(axis=0).tolist() if changed.any() else None,
      'baselineMeanRGBInChangedPixels':a[changed].mean(axis=0).tolist() if changed.any() else None,'draws':[v['draws'] for v in variants],'triangles':[v['triangles'] for v in variants],
      'counterScope':'Whole-frame counters include shadow every 4 frames and reflection every 3 frames; not a geometry budget delta or performance comparison.'})
assert all(r['candidateWhiteClipFraction']==0 for r in results)
(root/'comparison-metrics.json').write_text(json.dumps(results,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'views':len(results),'matchingPoseAndTime':True,'matchingCollisionStats':True,'whiteClippedPixels':0,'returnMAE':{r['name']:r['returnMeanAbsoluteDifference'] for r in results}}))
