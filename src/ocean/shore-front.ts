import * as THREE from 'three';

/** Persistent front descriptors; this is a tracked kinematic sheet driver, not
 * transported water volume. Texture lanes: position/identity, motion/age, shape.
 * Sampling functions are shared verbatim with the water sheet's vertex shader. */
export const shoreFrontEvolution = /* glsl */`
uniform sampler2D uFrontPreviousPosition,uFrontPreviousMotion,uFrontPreviousShape;
uniform vec2 uFrontSeed;
uniform float uFrontReset,uFrontSeconds,uFrontClock,uFrontCount,uFrontSpan;
layout(location=0) out vec4 frontPosition;
layout(location=1) out vec4 frontMotion;
layout(location=2) out vec4 frontShape;
struct Front { vec2 p; vec2 n; float height; float id; float speed; float age; float strength; float radius; float bed; };
Front emptyFront(vec2 p,vec2 n){return Front(p,n,0.,0.,0.,0.,0.,0.,0.);}
Front readFront(float index){
  vec2 uv=vec2((index+.5)/uFrontCount,.5);
  vec4 p=texture2D(uFrontPreviousPosition,uv),m=texture2D(uFrontPreviousMotion,uv),s=texture2D(uFrontPreviousShape,uv);
  return Front(p.xy,m.xy,p.z,p.w,m.z,m.w,s.x,s.y,s.z);
}
bool frontWater(vec2 p){
  vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw,c=coast(p);
  if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1)))||c.y<.18||c.x>=-.2||c.x<=-3.8)return false;
  if(uShoreReady>.5){vec2 s=(p-uShoreBounds.xy)/uShoreBounds.zw;
    if(any(lessThan(s,vec2(.04)))||any(greaterThan(s,vec2(.96))))return false;}
  return baseHeight(p)>c.x+.015;
}
float frontSlope(vec2 p,vec2 n){return (incidentHeight(p-n*.75)-incidentHeight(p+n*.75))/1.5;}
vec2 frontDirection(vec2 p,vec2 previous){
  vec2 descent=vec2(incidentHeight(p-vec2(.75,0))-incidentHeight(p+vec2(.75,0)),incidentHeight(p-vec2(0,.75))-incidentHeight(p+vec2(0,.75)));
  float magnitude=length(descent);vec2 n=descent/max(.00001,magnitude);
  return magnitude>.01&&dot(n,previous)>.5?n:previous;
}
float frontBirth(vec2 p,vec2 n){
  if(!frontWater(p))return 0.;
  vec2 c=coast(p);float h=incidentHeight(p),d=-c.x;
  float energy=max(frontEnergy(p),frontEnergy(p+n*.75));
  return smoothstep(.2,.6,d)*(1.-smoothstep(2.8,3.8,d))*smoothstep(.02,.25,energy)*smoothstep(.02,.2,h)*smoothstep(.003,.035,frontSlope(p,n))*clamp(c.y,0.,1.);
}
Front qualifyFront(Front f,float memory){
  if(!frontWater(f.p)||f.age>6.)return emptyFront(f.p,f.n);
  f.bed=coast(f.p).x;f.height=incidentHeight(f.p);
  f.strength=max(frontBirth(f.p,f.n),memory*exp(-uFrontSeconds/.65));
  if(f.strength<.005||frontSlope(f.p,f.n)<-.01)return emptyFront(f.p,f.n);
  f.radius=min(1.25,min(-f.bed*.36,max(0.,f.height)*.9))*f.strength;
  return f;
}
Front seedFront(vec2 centre,vec2 n,float radius,float samples,float id){
  Front f=emptyFront(centre,n);float best=0.,winner=0.;
  for(int i=0;i<49;i++){
    if(float(i)>=samples)break;
    float offset=(float(i)/(samples-1.)*2.-1.)*radius;
    vec2 p=centre+n*offset;float birth=frontBirth(p,n);
    float score=birth*max(0.,frontSlope(p,n))/(1.+.04*abs(offset));
    if(score>best){best=score;f.p=p;winner=offset;}
  }
  // An endpoint is evidence that the selected front is not localized yet.
  if(best<=0.||abs(winner)>=radius-.001)return f;
  vec2 coarse=f.p;float stepSize=radius/(samples-1.);
  for(int i=0;i<9;i++){
    float offset=(float(i)/8.*2.-1.)*stepSize;
    vec2 p=coarse+n*offset;
    float score=frontBirth(p,n)*max(0.,frontSlope(p,n))/(1.+.04*abs(winner+offset));
    if(score>best){best=score;f.p=p;}
  }
  f.id=id;f.n=frontDirection(f.p,n);f.speed=clamp(sqrt(9.81*max(.1,baseHeight(f.p)-coast(f.p).x)),.2,9.);
  return qualifyFront(f,0.);
}
Front advanceFront(Front old){
  Front f=old;f.age+=uFrontSeconds;
  if(!frontWater(old.p))return emptyFront(old.p,old.n);
  float slope=frontSlope(old.p,old.n);
  float observed=(incidentHeight(old.p)-old.height)/max(.008,slope)/max(.001,uFrontSeconds);
  float speed=clamp(observed,0.,12.);
  f.speed=old.age<.0001?speed:mix(old.speed,speed,1.-exp(-uFrontSeconds*8.));
  vec2 predicted=old.p+old.n*f.speed*uFrontSeconds;
  f.p=predicted;
  float reach=min(.18,3.*uFrontSeconds),best=-1.;
  // Bounded correction follows this front; it cannot select a distant taller wave.
  for(int i=0;i<7;i++){
    float offset=(float(i)/6.*2.-1.)*reach;
    vec2 p=predicted+old.n*offset;
    if(frontWater(p)){
      float score=max(0.,frontSlope(p,old.n))-.0002*abs(offset)/max(.001,reach);
      if(score>best){best=score;f.p=p;}
    }
  }
  f.n=normalize(mix(old.n,frontDirection(f.p,old.n),1.-exp(-uFrontSeconds*2.)));
  return qualifyFront(f,old.strength);
}
void main(){
  float middle=floor(uFrontCount*.5),index=floor(gl_FragCoord.x);
  Front centre=emptyFront(uFrontSeed,vec2(1,0));
  if(uFrontReset<.5)centre=readFront(middle);
  bool born=centre.id<.5;
  if(born){
    vec2 uphill=vec2(coast(uFrontSeed+vec2(2,0)).x-coast(uFrontSeed-vec2(2,0)).x,coast(uFrontSeed+vec2(0,2)).x-coast(uFrontSeed-vec2(0,2)).x);
    float gradient=length(uphill);vec2 n=uphill/max(.00001,gradient),seed=uFrontSeed;
    // Search actual wet breaking water, not an authored two-metre contour.
    // A wide gently sloping beach may not reach that contour anywhere nearby.
    if(gradient>.0001)centre=seedFront(seed,n,44.,49.,floor(uFrontClock*1000.)+1.);
  }else centre=advanceFront(centre);
  vec2 along=vec2(-centre.n.y,centre.n.x);
  float lateral=(index/(uFrontCount-1.)-.5)*uFrontSpan;
  Front row=emptyFront(centre.p+along*lateral,centre.n);
  if(centre.id>.5){
    if(index==middle)row=centre;
    else {
      Front old=emptyFront(row.p,centre.n);if(uFrontReset<.5)old=readFront(index);
      if(old.id==centre.id)row=advanceFront(old);
      else row=seedFront(row.p,centre.n,2.,17.,centre.id);
      if(row.id>.5&&abs(dot(row.p-centre.p,centre.n))>3.)row=emptyFront(row.p,centre.n);
    }
  }
  frontPosition=vec4(row.p,row.height,row.id);
  frontMotion=vec4(row.n,row.speed,row.age);
  frontShape=vec4(row.strength,row.radius,row.bed,row.id>.5?1.:0.);
}
`;

const fieldSampling=/*glsl*/`
uniform sampler2D uFrontField,uFrontFieldEnergy;
uniform vec4 uFrontFieldBounds,uBathyBounds,uShoreBounds;
uniform float uShoreReady,uSwell,uWind;
vec4 fieldAt(sampler2D field,vec2 p){
  vec2 uv=(p-uFrontFieldBounds.xy)/uFrontFieldBounds.zw;
  if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec4(0,0,-110,0);
  vec2 pixel=uv*192.-.5,cell=floor(pixel),f=fract(pixel);
  vec2 a=(clamp(cell,vec2(0),vec2(191))+.5)/192.;
  vec2 b=(clamp(cell+1.,vec2(0),vec2(191))+.5)/192.;
  return mix(mix(texture2D(field,a),texture2D(field,vec2(b.x,a.y)),f.x),mix(texture2D(field,vec2(a.x,b.y)),texture2D(field,b),f.x),f.y);
}
vec2 coast(vec2 p){return fieldAt(uFrontField,p).ba;}
float incidentHeight(vec2 p){return fieldAt(uFrontField,p).r;}
float baseHeight(vec2 p){return fieldAt(uFrontField,p).g;}
float frontEnergy(vec2 p){return max(0.,fieldAt(uFrontFieldEnergy,p).r);}
`;

export class ShoreFront {
  readonly uniforms:Record<string,THREE.IUniform>;
  readonly count:number;
  readonly span:number;
  private readonly renderer:THREE.WebGLRenderer;
  private readonly targets:THREE.WebGLRenderTarget[];
  private readonly material:THREE.ShaderMaterial;
  private readonly fieldTarget:THREE.WebGLRenderTarget|null;
  private readonly fieldMaterial:THREE.ShaderMaterial|null;
  private readonly fieldBounds={value:new THREE.Vector4()};
  private readonly scene=new THREE.Scene();
  private readonly camera=new THREE.Camera();
  private readonly quad:THREE.Mesh;
  private index=0;
  private initialized=false;
  private disposed=false;
  private lastTime:number|null=null;
  private passes=0;
  private resets=0;
  private readonly anchor=new THREE.Vector2(Infinity,Infinity);
  private bed:THREE.Texture|null=null;
  private bedVersion=-1;
  private readonly bounds=new THREE.Vector4();
  private readonly resolution=new THREE.Vector2();
  private triangulated=-1;
  private solverReady=-1;
  private spectrum='';
  constructor(renderer:THREE.WebGLRenderer,sampling:string,shared:Record<string,THREE.IUniform>,count=97,span=32,cacheField=false){
    if(!Number.isInteger(count)||count<3||count>129||count%2!==1||!Number.isFinite(span)||span<=0)throw new RangeError('An odd bounded front row is required');
    this.renderer=renderer;this.count=count;this.span=span;
    this.targets=Array.from({length:2},()=>new THREE.WebGLRenderTarget(count,1,{count:3,type:THREE.FloatType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false,stencilBuffer:false}));
    this.fieldTarget=cacheField?new THREE.WebGLRenderTarget(192,192,{count:2,type:THREE.FloatType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false,stencilBuffer:false}):null;
    // Evaluate the expensive shared FFT/SWE sampling once on a metric field.
    // Keeping it outside the tracking search also bounds driver shader size.
    this.fieldMaterial=cacheField?new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,toneMapped:false,
      uniforms:{...shared,uFrontFieldBounds:this.fieldBounds},vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:sampling+`
        uniform vec4 uFrontFieldBounds;
        layout(location=0) out vec4 waterField;layout(location=1) out vec4 energyField;
        void main(){
          vec2 p=uFrontFieldBounds.xy+gl_FragCoord.xy/192.*uFrontFieldBounds.zw,c=coast(p);
          float h=incidentHeight(p),energy=uShoreReady>.5?whitewaterSolvedFlow(p).z:shoreBreakerDissipation(h/max(.3,uSwell),c,uSwell,uWind);
          waterField=vec4(h,baseHeight(p),c);energyField=vec4(energy,0,0,1);
        }`}):null;
    this.uniforms={uFrontPosition:{value:this.targets[0].textures[0]},uFrontMotion:{value:this.targets[0].textures[1]},uFrontShape:{value:this.targets[0].textures[2]},uFrontCount:{value:count},uFrontReady:{value:0}};
    this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,toneMapped:false,
      uniforms:{...shared,uFrontPreviousPosition:{value:null},uFrontPreviousMotion:{value:null},uFrontPreviousShape:{value:null},uFrontSeed:{value:new THREE.Vector2()},uFrontReset:{value:1},uFrontSeconds:{value:0},uFrontClock:{value:0},uFrontCount:this.uniforms.uFrontCount,uFrontSpan:{value:span},uFrontFieldBounds:this.fieldBounds,uFrontField:{value:this.fieldTarget?.textures[0]},uFrontFieldEnergy:{value:this.fieldTarget?.textures[1]}},
      vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:(cacheField?fieldSampling:sampling)+shoreFrontEvolution});
    this.quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.material);this.quad.frustumCulled=false;this.scene.add(this.quad);
  }
  bindUniforms(shared:Record<string,THREE.IUniform>):void {for(const [name,value] of Object.entries(shared))if(!name.startsWith('uFront')){this.material.uniforms[name]=value;if(this.fieldMaterial)this.fieldMaterial.uniforms[name]=value;}}
  update(seconds:number,time:number,x:number,z:number):void {
    if(this.disposed)return;
    if(![seconds,time,x,z].every(Number.isFinite)||seconds<0||seconds>.1){this.reset();return;}
    const u=this.material.uniforms,bed=u.uBathymetry?.value as THREE.Texture|null;
    if(!bed||!u.uLongWaves?.value||!u.uShortWaves?.value||!this.renderer.extensions.has('EXT_color_buffer_float')){this.reset();return;}
    const bounds=u.uBathyBounds.value as THREE.Vector4,resolution=u.uBathyResolution.value as THREE.Vector2;
    const spectrum=[u.uWind?.value,u.uSwell?.value,u.uChoppiness?.value].join(':');
    const changed=this.bed!==bed||this.bedVersion!==bed.version||!this.bounds.equals(bounds)||!this.resolution.equals(resolution)||this.triangulated!==u.uBathyTriangulated.value||this.solverReady!==u.uShoreReady.value||spectrum!==this.spectrum;
    const timeChanged=this.lastTime!==null&&(time<this.lastTime||Math.abs(time-this.lastTime-seconds)>.08);
    if(changed||timeChanged||(x-this.anchor.x)**2+(z-this.anchor.y)**2>this.span*this.span*2.25){
      this.reset();this.anchor.set(x,z);this.bed=bed;this.bedVersion=bed.version;this.bounds.copy(bounds);this.resolution.copy(resolution);this.triangulated=u.uBathyTriangulated.value;this.solverReady=u.uShoreReady.value;this.spectrum=spectrum;
    }
    this.lastTime=time;
    if(this.initialized&&seconds===0)return;
    const r=this.renderer,saved={target:r.getRenderTarget(),face:r.getActiveCubeFace(),mip:r.getActiveMipmapLevel(),viewport:r.getViewport(new THREE.Vector4()),scissor:r.getScissor(new THREE.Vector4()),scissorTest:r.getScissorTest(),xr:r.xr.enabled,auto:r.autoClear};
    try{
      r.xr.enabled=false;r.autoClear=false;r.setScissorTest(false);
      if(this.fieldTarget&&this.fieldMaterial){
        this.fieldBounds.value.set(Math.floor((x-48)*2)*.5,Math.floor((z-48)*2)*.5,96,96);
        this.quad.material=this.fieldMaterial;r.setRenderTarget(this.fieldTarget);r.render(this.scene,this.camera);this.quad.material=this.material;
      }
      u.uFrontSeed.value.set(x,z);u.uFrontReset.value=this.initialized?0:1;u.uFrontSeconds.value=seconds;u.uFrontClock.value=time;
      const old=this.targets[this.index];u.uFrontPreviousPosition.value=old.textures[0];u.uFrontPreviousMotion.value=old.textures[1];u.uFrontPreviousShape.value=old.textures[2];
      const next=1-this.index;r.setRenderTarget(this.targets[next]);r.render(this.scene,this.camera);
      this.index=next;for(const [i,name] of ['uFrontPosition','uFrontMotion','uFrontShape'].entries())this.uniforms[name].value=this.targets[next].textures[i];
      this.initialized=true;this.uniforms.uFrontReady.value=1;this.passes++;
    }finally{this.quad.material=this.material;r.setRenderTarget(saved.target,saved.face,saved.mip);r.setViewport(saved.viewport);r.setScissor(saved.scissor);r.setScissorTest(saved.scissorTest);r.xr.enabled=saved.xr;r.autoClear=saved.auto;}
  }
  reset():void {this.initialized=false;this.lastTime=null;this.uniforms.uFrontReady.value=0;this.resets++;}
  /** Explicit development observation; no normal-frame readback. */
  probe(){
    const lanes=Array.from({length:3},()=>new Float32Array(this.count*4));
    if(this.initialized)for(let lane=0;lane<3;lane++)this.renderer.readRenderTargetPixels(this.targets[this.index],0,0,this.count,1,lanes[lane],0,lane);
    return {available:this.initialized,tracked:true,...this.diagnostics,fronts:Array.from({length:this.count},(_,i)=>({index:i,position:Array.from(lanes[0].slice(i*4,i*4+4)),motion:Array.from(lanes[1].slice(i*4,i*4+4)),shape:Array.from(lanes[2].slice(i*4,i*4+4))}))};
  }
  get diagnostics(){return {count:this.count,span:this.span,passes:this.passes,resets:this.resets,ready:this.initialized,fieldCellM:this.fieldTarget ? .5 : null,bytes:2*3*this.count*16+(this.fieldTarget?192*192*2*16:0),scope:'Persistent kinematic front descriptors; optional 0.5m field interpolation, no mass transport, ballistic sheet history, air-cavity contact, or CFD'};}
  dispose():void {if(this.disposed)return;this.disposed=true;this.reset();this.targets.forEach(t=>t.dispose());this.fieldTarget?.dispose();this.fieldMaterial?.dispose();this.material.dispose();this.quad.geometry.dispose();this.scene.clear();}
}
