import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeElevation} from '../src/world/decode-elevation.ts';
import {NIIJIMA_NATIVE_SURVEY} from '../src/world/niijima-survey-native.generated.ts';
import {TOMARI_SURVEY} from '../src/world/tomari-survey.generated.ts';
import {TOMARI_EAST_SURVEY} from '../src/world/tomari-east-survey.generated.ts';
import {ELEVATION_RASTERS} from '../src/world/geodata.generated.ts';
import {NIIJIMA_DETAIL_RASTER} from '../src/world/niijima-detail-repaired.generated.ts';
import * as north from '../src/world/niijima-north.generated.ts';
import * as south from '../src/world/niijima-south.generated.ts';

const sampleBytes=Buffer.alloc(10);
[-32768,-1,0,1,32767].forEach((v,i)=>sampleBytes.writeInt16LE(v,i*2));
const sample=sampleBytes.toString('base64');
const nativeDescriptor=Object.getOwnPropertyDescriptor(Uint8Array,'fromBase64');
function withDecoder(decoder:((s:string)=>Uint8Array)|undefined,run:()=>void):void {
  Object.defineProperty(Uint8Array,'fromBase64',{configurable:true,writable:true,value:decoder});
  try{run();}finally{
    if(nativeDescriptor)Object.defineProperty(Uint8Array,'fromBase64',nativeDescriptor);
    else Reflect.deleteProperty(Uint8Array,'fromBase64');
  }
}

test('fallback preserves signed endpoints, missing-data sentinel and independent ownership',()=>{
  withDecoder(undefined,()=>{
    const a=decodeElevation(sample,5),b=decodeElevation(sample,5);
    assert.deepEqual([...a],[-32768,-1,0,1,32767]);
    a[0]=12;assert.equal(b[0],-32768);
    assert.throws(()=>decodeElevation(sample,6),/Incomplete/);
    assert.throws(()=>decodeElevation('AA==',1),/Incomplete/);
    assert.throws(()=>decodeElevation('!!',1));
  });
});

test('native decoder reuses its byte buffer and respects a nonzero aligned offset',()=>{
  const storage=new Uint8Array(14);storage.set(sampleBytes,2);
  const bytes=storage.subarray(2,12);
  withDecoder(()=>bytes,()=>{
    const values=decodeElevation(sample,5);
    assert.equal(values.buffer,storage.buffer);assert.equal(values.byteOffset,2);
    assert.deepEqual([...values],[-32768,-1,0,1,32767]);
    assert.throws(()=>decodeElevation(sample,6),/Incomplete/);
  });
});

test('all shipped elevation samples match independent little-endian decoding exactly',()=>{
  const surveys=[NIIJIMA_NATIVE_SURVEY,TOMARI_SURVEY,TOMARI_EAST_SURVEY];
  const rasters=[...ELEVATION_RASTERS,NIIJIMA_DETAIL_RASTER,
    ...Object.values(north).filter(v=>'elevations' in v),
    ...Object.values(south).filter(v=>'elevations' in v)];
  const sources=[...surveys.map(s=>({encoded:s.heightsCentimetres,count:s.width*s.height})),
    ...rasters.map(s=>({encoded:s.elevations,count:s.width*s.height}))];
  withDecoder(undefined,()=>{
    for(const source of sources){
      const expected=Buffer.from(source.encoded,'base64'),actual=decodeElevation(source.encoded,source.count);
      for(let i=0;i<actual.length;i++)assert.equal(actual[i],expected.readInt16LE(i*2),`sample ${i}`);
    }
  });
});
