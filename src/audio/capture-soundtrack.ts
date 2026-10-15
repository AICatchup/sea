import {EnvironmentGraph} from './environment-graph.ts';
import {SoundscapeState,type SoundscapeFrame} from './soundscape-state.ts';

/** Render the game's own mix on simulation time, without microphone capture.
 * Offline scheduling keeps slow diagnostic frame rendering from desynchronizing audio.
 */
export async function captureSoundtrack(frames:SoundscapeFrame[],duration:number):Promise<string>{
  if(!frames.length||frames.length>181||!Number.isFinite(duration)||duration<=0||duration>21)throw new Error('Bounded capture required');
  const origin=frames[0].time;
  for(let i=0;i<frames.length;i++)if(!Number.isFinite(frames[i].time)||frames[i].time<origin||(i>0&&frames[i].time<=frames[i-1].time))throw new Error('Ordered sound frames required');
  const context=new OfflineAudioContext(2,Math.ceil(duration*48000),48000);
  const graph=new EnvironmentGraph(context),model=new SoundscapeState();
  try{
    await graph.ready;graph.setPlaying(true);
    const apply=(i:number)=>{const f={...frames[i],dt:i?frames[i].time-frames[i-1].time:1/60};graph.update(model.update(f),f,true);};
    apply(0);
    const scheduled=frames.slice(1).map((frame,j)=>{
      const time=frame.time-origin;
      if(time>=duration)return Promise.resolve();
      return context.suspend(time).then(()=>{apply(j+1);return context.resume();});
    });
    const buffer=await context.startRendering();await Promise.all(scheduled);
    const bytes=new ArrayBuffer(44+buffer.length*4),view=new DataView(bytes);
    const text=(offset:number,s:string)=>{for(let i=0;i<s.length;i++)view.setUint8(offset+i,s.charCodeAt(i));};
    text(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,48000,true);view.setUint32(28,192000,true);view.setUint16(32,4,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,buffer.length*4,true);
    for(let i=0;i<buffer.length;i++)for(let c=0;c<2;c++)view.setInt16(44+(i*2+c)*2,Math.round(Math.max(-1,Math.min(1,buffer.getChannelData(c)[i]))*32767),true);
    return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(new Blob([bytes],{type:'audio/wav'}));});
  }finally{graph.dispose();}
}
