// Run each mode in its own process: node --experimental-strip-types --expose-gc
// scripts/benchmark-elevation.mjs legacy|current
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {NIIJIMA_NATIVE_SURVEY as data} from '../src/world/niijima-survey-native.generated.ts';
import {decodeElevation} from '../src/world/decode-elevation.ts';
const mode=process.argv[2];
if(!['legacy','current'].includes(mode))throw new Error('Choose legacy or current');
global.gc?.();
const before=process.memoryUsage(),start=performance.now();
let heights,valid;
if(mode==='legacy'){
  const raw=Uint8Array.from(atob(data.heightsCentimetres),c=>c.charCodeAt(0));
  const view=new DataView(raw.buffer);
  heights=new Float32Array(data.width*data.height);valid=new Uint8Array(heights.length);
  for(let i=0;i<heights.length;i++){const value=view.getInt16(i*2,true);if(value!==-32768){heights[i]=value*.01;valid[i]=1;}}
}else{
  const values=decodeElevation(data.heightsCentimetres,data.width*data.height);
  heights=new Float32Array(data.width*data.height);valid=new Uint8Array(heights.length);
  for(let i=0;i<heights.length;i++){const value=values[i];if(value!==-32768){heights[i]=value*.01;valid[i]=1;}}
}
const elapsedMs=performance.now()-start,after=process.memoryUsage();
console.log(JSON.stringify({mode,samples:heights.length,nativeDecoder:typeof Uint8Array.fromBase64==='function',elapsedMs,
  heapGrowthBytes:after.heapUsed-before.heapUsed,rssGrowthBytes:after.rss-before.rss,peakRssKiB:process.resourceUsage().maxRSS,
  sha256:createHash('sha256').update(new Uint8Array(heights.buffer)).update(valid).digest('hex')},null,2));
