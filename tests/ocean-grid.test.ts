import test from 'node:test';import assert from 'node:assert/strict';
import {OCEAN_RINGS,OCEAN_SECTORS,OCEAN_RADIUS,oceanRingRadius} from '../src/ocean/ocean-grid.ts';
test('ocean grid covers the horizon and allocates metre-scale edges to the surf',()=>{
  assert.equal(oceanRingRadius(0),0);assert.ok(Math.abs(oceanRingRadius(OCEAN_RINGS)-OCEAN_RADIUS)<1e-8);
  for(let i=1;i<=OCEAN_RINGS;i++){
    const r=oceanRingRadius(i),previous=oceanRingRadius(i-1);assert.ok(r>previous);
    if(r<=40)assert.ok(r-previous<1.05);
    if(r<=80)assert.ok(r-previous<2.05);
    if(r<=100)assert.ok(r-previous<2.55);
  }
  assert.ok((OCEAN_RINGS+1)*(OCEAN_SECTORS+1)<125000);
});
test('a displaced crest 80m away has lower interpolation error than the old radial grid',()=>{
  const wave=(r:number,center:number)=>1.8*Math.exp(-(((r-center)/2)**2));
  const error=(radii:number[])=>{
    let maximum=0;
    for(let center=75;center<=85;center+=.5)
      for(let i=1;i<radii.length;i++)if(radii[i-1]>=65&&radii[i]<=95)
        for(let j=1;j<20;j++){const t=j/20,r=radii[i-1]*(1-t)+radii[i]*t;maximum=Math.max(maximum,Math.abs(wave(r,center)-(wave(radii[i-1],center)*(1-t)+wave(radii[i],center)*t)));}
    return maximum;
  };
  const old=Array.from({length:231},(_,i)=>i===0?0:.12*Math.exp(i/230*Math.log(28000/.12)));
  const updated=Array.from({length:OCEAN_RINGS+1},(_,i)=>oceanRingRadius(i));
  assert.ok(error(updated)<error(old)*.5);
});
