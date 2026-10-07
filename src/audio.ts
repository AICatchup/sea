import {SoundscapeState,type SoundscapeFrame,type SoundscapeTargets} from './audio/soundscape-state.ts';
import {EnvironmentGraph} from './audio/environment-graph.ts';
/** Context starts only after a user gesture; game state drives a bounded local mix. */
export class SurfAudio{
 enabled=false;private context:AudioContext|null=null;private graph:EnvironmentGraph|null=null;
 private visible=!document.hidden;private paused=false;private disposed=false;private wind=7.5;
 private model=new SoundscapeState();private operation:Promise<void>=Promise.resolve();private suspendTimer=0;
 private lastTargets:SoundscapeTargets|null=null;private frame:SoundscapeFrame|null=null;
 private get playing(){return this.enabled&&this.visible&&!this.paused&&!this.disposed;}
 async toggle():Promise<boolean>{
  if(this.disposed)return false;
  if(!this.context){this.context=new AudioContext();this.graph=new EnvironmentGraph(this.context);}
  this.enabled=!this.enabled;try{await this.synchronize();}catch(e){this.enabled=false;this.graph?.setPlaying(false);throw e;}return this.enabled;
 }
 setWind(wind:number):void{if(Number.isFinite(wind))this.wind=Math.max(0,Math.min(30,wind));}
 setFrame(frame:SoundscapeFrame):void{
  if(this.disposed)return;this.frame=frame;const f={...frame,dt:this.playing?frame.dt:0,environment:{...frame.environment,windSpeed:this.wind}};
  this.lastTargets=this.model.update(f);this.graph?.update(this.lastTargets,f,this.playing&&this.context?.state==='running');
 }
 cue():void{if(this.playing&&this.context?.state==='running')this.graph?.cue();}
 setVisible(visible:boolean):Promise<void>{this.visible=visible;return this.synchronize();}
 setPaused(paused:boolean):Promise<void>{this.paused=paused;return this.synchronize();}
 private synchronize(immediate=false):Promise<void>{
  clearTimeout(this.suspendTimer);if(!this.playing)this.graph?.setPlaying(false);
  this.operation=this.operation.catch(()=>{}).then(async()=>{const c=this.context;if(!c||this.disposed||c.state==='closed')return;clearTimeout(this.suspendTimer);
   if(this.playing){await c.resume();if(this.playing)this.graph?.setPlaying(true);else await c.suspend();}
   else if(!this.visible||immediate)await c.suspend();
   else if(c.state==='running')this.suspendTimer=window.setTimeout(()=>{void this.synchronize(true).catch(()=>{});},350);
  });return this.operation;
 }
 get diagnostics(){return{enabled:this.enabled,playing:this.playing,context:this.context?.state??'not-created',targets:this.lastTargets,graph:this.graph?.diagnostics??null,mode:this.frame?.mode};}
 /** Records our output only. Does not request a microphone or device capture. */
 async record(milliseconds=5000):Promise<Blob>{
  if(!this.graph||!this.context||!this.playing)throw new Error('Enable sound before recording');
  const graph=this.graph,stream=this.context.createMediaStreamDestination();graph.limiter.connect(stream);
  const mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/webm';
  const recorder=new MediaRecorder(stream.stream,{mimeType:mime}),chunks:BlobPart[]=[];
  try{return await new Promise<Blob>((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.onerror=()=>reject(new Error('Audio recording failed'));recorder.onstop=()=>resolve(new Blob(chunks,{type:mime}));recorder.start();setTimeout(()=>{if(recorder.state!=='inactive')recorder.stop();},Math.max(500,Math.min(15000,milliseconds)));});}
  finally{try{graph.limiter.disconnect(stream);}catch{}stream.stream.getTracks().forEach(t=>t.stop());stream.disconnect();}
 }
 dispose():void{if(this.disposed)return;this.disposed=true;this.enabled=false;clearTimeout(this.suspendTimer);this.graph?.dispose();this.graph=null;const c=this.context;this.context=null;if(c&&c.state!=='closed')void c.close().catch(()=>{});}
}
