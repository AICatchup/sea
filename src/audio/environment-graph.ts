import type {SoundscapeFrame,SoundscapeTargets} from './soundscape-state.ts';
const urls={wind:new URL('../assets/audio/sea-wind-soft.ogg',import.meta.url).href,hullwash:new URL('../assets/audio/hull-water-calm.ogg',import.meta.url).href,engine:new URL('../assets/audio/sea-engine-idle.ogg',import.meta.url).href,bird:new URL('../assets/audio/sea-bird-call.ogg',import.meta.url).href,creak:new URL('../assets/audio/sea-hull-creak.ogg',import.meta.url).href,stepSand:new URL('../assets/audio/sea-step-sand.ogg',import.meta.url).href,stepWater:new URL('../assets/audio/sea-step-water.ogg',import.meta.url).href,breath:new URL('../assets/audio/sea-scuba-breath.ogg',import.meta.url).href,surf:new URL('../assets/audio/sea-surf-wash.ogg',import.meta.url).href};
const loopNames=['wind','hullwash','engine','breath','surf'];
type Layer={gain:GainNode;filter:BiquadFilterNode;pan:StereoPannerNode;source:AudioBufferSourceNode};
/** One graph per gesture-created context. Motion changes parameters, never allocates loops per frame. */
export class EnvironmentGraph{
 readonly output:GainNode;readonly limiter:DynamicsCompressorNode;readonly ready:Promise<void>;
 private layers=new Map<string,Layer>();private samples=new Map<string,AudioBuffer>();private nodes:AudioNode[]=[];
 private shots=new Set<AudioBufferSourceNode>();private disposed=false;private creakCooldown=0;private noise:AudioBuffer;
 private frames=0;private shotCount=0;private failures:string[]=[];
 constructor(private readonly context:AudioContext){
  this.output=context.createGain();this.output.gain.value=0;this.limiter=context.createDynamicsCompressor();
  this.limiter.threshold.value=-12;this.limiter.knee.value=12;this.limiter.ratio.value=8;this.limiter.attack.value=.006;this.limiter.release.value=.25;
  this.output.connect(this.limiter).connect(context.destination);this.nodes.push(this.output,this.limiter);
  this.noise=context.createBuffer(2,context.sampleRate*8,context.sampleRate);
  let seed=81;for(let c=0;c<2;c++){const a=this.noise.getChannelData(c);let brown=0;for(let i=0;i<a.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const white=seed/2147483648-1;brown=(brown+white*.055)/1.025;a[i]=brown*.55+white*.025;}const join=Math.floor(context.sampleRate*.15);for(let i=0;i<join;i++){const t=i/(join-1);a[a.length-join+i]=a[a.length-join+i]*(1-t)+a[i]*t;}}
  for(const name of ['surf','swim','breath','bubbles'])this.loop(name,this.noise,.15);
  this.ready=Promise.all(Object.entries(urls).map(async([name,url])=>{try{const response=await fetch(url);if(!response.ok)throw new Error('sound unavailable');const buffer=await context.decodeAudioData(await response.arrayBuffer());if(this.disposed)return;this.samples.set(name,buffer);if(loopNames.includes(name))this.loop(name,buffer,0);}catch{if(!this.disposed){this.failures.push(name);if(loopNames.includes(name)&&!this.layers.has(name))this.loop(name,this.noise,.15);}}})).then(()=>{});
 }
 private loop(name:string,buffer:AudioBuffer,start:number):void{
  const old=this.layers.get(name);if(old){try{old.source.stop();}catch{}[old.source,old.filter,old.gain,old.pan].forEach(n=>n.disconnect());}
  const c=this.context,source=c.createBufferSource(),gain=c.createGain(),filter=c.createBiquadFilter(),pan=c.createStereoPanner();
  source.buffer=buffer;source.loop=true;source.loopStart=start;gain.gain.value=0;filter.type='lowpass';filter.frequency.value=1800;filter.Q.value=.25;
  source.connect(filter).connect(gain).connect(pan).connect(this.output);source.start();this.nodes.push(source,filter,gain,pan);this.layers.set(name,{source,gain,filter,pan});
 }
 setPlaying(playing:boolean):void{if(this.disposed)return;const now=this.context.currentTime;this.output.gain.cancelScheduledValues(now);this.output.gain.setTargetAtTime(playing?.72:0,now,.06);if(!playing){for(const source of this.shots)try{source.stop();}catch{}this.creakCooldown=0;}}
 update(t:SoundscapeTargets,f:SoundscapeFrame,audible:boolean):void{
  if(this.disposed)return;this.frames++;const now=this.context.currentTime;
  const gains:Record<string,number>={wind:t.wind*.48,hullwash:(t.hullwash+(f.mode==='boat'?.08:0))*t.airTransmission*.62,engine:t.engine*.45,surf:t.surf*.6,swim:t.swim*.55,breath:t.breath*.65,bubbles:t.bubbles*.48};
  for(const[name,l]of this.layers){l.gain.gain.setTargetAtTime(gains[name]??0,now,.12);l.filter.frequency.setTargetAtTime(name==='wind'?t.windCutoffHz:name==='engine'?Math.min(2400,t.cutoffHz):name==='breath'?1100:name==='bubbles'?650:t.cutoffHz,now,.12);l.pan.pan.setTargetAtTime(name==='wind'?t.pan*.42:0,now,.15);if(name==='engine')l.source.playbackRate.setTargetAtTime(t.enginePitch,now,.25);}
  if(!audible)return;this.creakCooldown=Math.max(0,this.creakCooldown-Math.min(.05,f.dt));
  if(t.creak>.08&&this.creakCooldown===0){this.oneShot('creak',Math.min(.25,t.creak*.45),.1,1);this.creakCooldown=2.1;}
  if(t.bird)this.oneShot('bird',t.bird.amplitude*.65,t.bird.pan,.95+t.bird.variation*.12);
  for(const step of t.footsteps)this.footstep(step.amplitude,step.variation,step.pan,(f.bodyImmersion??0)>.12);
 }
 private oneShot(name:string,volume:number,panValue:number,rate:number):void{
  const buffer=this.samples.get(name);if(!buffer||this.shots.size>=8)return;const source=this.context.createBufferSource(),gain=this.context.createGain(),pan=this.context.createStereoPanner();source.buffer=buffer;source.playbackRate.value=rate;gain.gain.value=volume;pan.pan.value=panValue;source.connect(gain).connect(pan).connect(this.output);this.shots.add(source);this.shotCount++;source.onended=()=>{source.disconnect();gain.disconnect();pan.disconnect();this.shots.delete(source);};source.start();
 }
 private footstep(volume:number,variation:number,panValue:number,wet:boolean):void{
  const name=wet?'stepWater':'stepSand';if(this.samples.has(name)){this.oneShot(name,volume*.4,panValue,.9+variation*.2);return;}
  if(this.shots.size>=8)return;const c=this.context,source=c.createBufferSource(),gain=c.createGain(),filter=c.createBiquadFilter(),pan=c.createStereoPanner();source.buffer=this.noise;source.playbackRate.value=.8+variation*.4;filter.type='lowpass';filter.frequency.value=wet?2100:950;gain.gain.value=0;const now=c.currentTime;gain.gain.linearRampToValueAtTime(volume*(wet?.45:.28),now+.02);gain.gain.exponentialRampToValueAtTime(.0001,now+(wet?.27:.16));pan.pan.value=panValue;source.connect(filter).connect(gain).connect(pan).connect(this.output);this.shots.add(source);this.shotCount++;source.onended=()=>{[source,filter,gain,pan].forEach(n=>n.disconnect());this.shots.delete(source);};source.start(now,variation*5);source.stop(now+.32);
 }
 cue():void{const c=this.context,g=c.createGain(),o=c.createOscillator(),now=c.currentTime;o.type='sine';o.frequency.setValueAtTime(660,now);o.frequency.setValueAtTime(880,now+.09);g.gain.setValueAtTime(.025,now);g.gain.exponentialRampToValueAtTime(.0001,now+.32);o.connect(g).connect(this.output);o.onended=()=>{o.disconnect();g.disconnect();};o.start();o.stop(now+.34);}
 get diagnostics(){return{layers:this.layers.size,decoded:[...this.samples.keys()],failures:[...this.failures],activeShots:this.shots.size,shotCount:this.shotCount,frames:this.frames,master:this.output.gain.value,reduction:this.limiter.reduction};}
 dispose():void{if(this.disposed)return;this.disposed=true;for(const l of this.layers.values())try{l.source.stop();}catch{}for(const s of this.shots)try{s.stop();}catch{}this.nodes.forEach(n=>n.disconnect());this.samples.clear();this.layers.clear();}
}
