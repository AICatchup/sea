import test from 'node:test';import assert from 'node:assert/strict';
import {crestAttachmentOffset as offset,CREST_ATTACHMENT_SECONDS as duration} from '../src/ocean/breaker-attachment.ts';

test('emission boundary matches both height and tangent, then leaves the flight unchanged',()=>{
  const dt=1e-6;
  for(const height of [-.4,0,.4])for(const rate of [-3,0,3]){
    assert.equal(offset(height,rate,0),height);
    assert.ok(Math.abs((offset(height,rate,dt)-height)/dt-rate)<.001);
    assert.ok(Math.abs(offset(height,rate,duration-dt)/dt)<.001,'no normal seam at the end of the correction');
    for(const age of [duration,.3,1,2.4])assert.equal(offset(height,rate,age),0);
  }
});
test('attachment support follows material time, not a fraction of the entire front age',()=>{
  for(const frontAge of [.2,.8,2.4]){
    const materialAge=.08,uv=materialAge/frontAge;
    assert.ok(Math.abs(offset(.3,1,uv*frontAge)-offset(.3,1,materialAge))<1e-12);
    assert.equal(offset(.3,1,.15),0,'an older parcel cannot be dragged back onto a later wave');
  }
  assert.equal(offset(NaN,0,.03),0);
});
