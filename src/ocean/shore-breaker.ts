import * as THREE from 'three';
import { shoreWaveSampling, shoreBreakerDissipationSampling } from './surface-detail.ts';
import { shoreSolverSampling, createShoreSolverUniforms } from './shore-solver.ts';
import { oceanFragment } from './shaders.ts';
import {whitewaterFlowSampling} from './whitewater-flow.ts';

const SEGMENTS=96, SPAN=32;
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/** CPU mirror of the sheet gate, for boundedness and negative-path checks. */
export function breakerSheetEnvelope(depth:number,energy:number,crest:number,slope:number,curvature:number,shelter:number):number {
  if(![depth,energy,crest,slope,curvature,shelter].every(Number.isFinite)||depth<=.2||depth>=3.8||shelter<.18)return 0;
  return smooth(.2,.6,depth)*(1-smooth(2.8,3.8,depth))*smooth(.02,.25,energy)*smooth(.02,.2,crest)*smooth(.0001,.003,slope)*smooth(.00002,.001,-curvature)*Math.min(1,shelter);
}

/** Mirror of the bounded instantaneous upstream maximum search (metres).
 * Exposes sampling counterexamples without a GPU/readback. */
export function breakerTrackedCrest(sample:(x:number)=>number,source:number):{peak:number;curvature:number;interior:boolean} {
  let best=-Infinity,offset=0;
  for(let i=0;i<9;i++){const t=i*.5,h=sample(source-t);if(h>best){best=h;offset=t;}}
  const peak=source-offset,h=sample(peak),behind=sample(peak-.5),ahead=sample(peak+.5);
  const curvature=(ahead+behind-2*h)/.25;
  const refine=Math.max(-.25,Math.min(.25,(ahead-behind)/Math.max(.0001,-curvature)));
  return {peak:peak+refine,curvature,interior:offset<4&&[best,curvature,refine].every(Number.isFinite)};
}

/** CPU mirror of the metric ribbon section, also useful for envelope audits.
 * q is material distance along the incident shoulder, not elapsed time. */
export function breakerCurlSection(q:number,radius:number,base:number,crest:number,side=0):{x:number;y:number;nx:number;ny:number;active:boolean} {
  const angle=3.665191429188092; // 210 degrees, genuinely beyond vertical
  if(![q,radius,base,crest,side].every(Number.isFinite)||radius<=0||q<0||q>radius*angle)return {x:q,y:base,nx:0,ny:1,active:false};
  const theta=q/radius,blend=smooth(0,.18,theta),thickness=radius*.25*side*blend;
  return {x:q+(radius*(1-Math.cos(theta))-q)*blend-Math.cos(theta)*thickness,
    y:base+(crest+radius*Math.sin(theta)-base)*blend+Math.sin(theta)*thickness,
    nx:-Math.cos(theta),ny:Math.sin(theta),active:true};
}

/** Bounded instantaneous FFT-driven kinematic bilayer, with shared SWE base.
 * No clock, readback, new texture, persistent breaker IDs, or fluid closure. */
export class ShoreBreaker {
  readonly group=new THREE.Group();
  readonly material:THREE.ShaderMaterial;
  readonly triangleCount=SEGMENTS*SEGMENTS*4;
  private readonly geometry:THREE.BufferGeometry;
  private disposed=false;
  constructor(){
    const plane=new THREE.PlaneGeometry(SPAN,SPAN,SEGMENTS,SEGMENTS);plane.rotateX(-Math.PI/2);
    const a=plane.getAttribute('position'),count=a.count;
    const positions=new Float32Array(count*6),sides=new Float32Array(count*2);
    for(let i=0;i<count;i++)for(let j=0;j<2;j++){
      const k=i+j*count;positions[k*3]=a.getX(i);positions[k*3+2]=a.getZ(i);sides[k]=j===0?.5:-.5;
    }
    const original=plane.index!,indices=new Uint32Array(original.count*2);
    for(let i=0;i<original.count;i+=3){
      indices.set([original.getX(i),original.getX(i+1),original.getX(i+2)],i);
      indices.set([original.getX(i+2)+count,original.getX(i+1)+count,original.getX(i)+count],original.count+i);
    }
    this.geometry=new THREE.BufferGeometry();this.geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    this.geometry.setAttribute('sheetSide',new THREE.BufferAttribute(sides,1));this.geometry.setIndex(new THREE.BufferAttribute(indices,1));plane.dispose();
    this.material=new THREE.ShaderMaterial({depthWrite:true,depthTest:true,side:THREE.DoubleSide,defines:{CURVED_SURFACE:1},
      uniforms:{...createShoreSolverUniforms(),uOrigin:{value:new THREE.Vector2()},uLongWaves:{value:null},uShortWaves:{value:null},uBathymetry:{value:null},uBathyTriangulated:{value:0},uBathyBounds:{value:new THREE.Vector4()},uBathyResolution:{value:new THREE.Vector2()},uSwell:{value:1},uWind:{value:8.5},uChoppiness:{value:1.55}},
      vertexShader:`uniform vec2 uOrigin;uniform sampler2D uLongWaves,uShortWaves,uBathymetry;uniform vec4 uBathyBounds;uniform vec2 uBathyResolution;uniform float uSwell,uWind,uChoppiness;
      attribute float sheetSide;
      varying vec3 vWorld;varying vec2 vOcean;varying float vDistance,vEnvelope,vLip,vWaterThickness;
      ${shoreWaveSampling}
      ${shoreBreakerDissipationSampling}
      ${shoreSolverSampling}
      ${whitewaterFlowSampling}
      vec2 coast(vec2 p){vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec2(-110,1);return sampleCoastalGround(uBathymetry,uv,uBathyResolution).rg;}
      vec3 raw(vec2 p){return texture2D(uLongWaves,p/384.).xyz+texture2D(uShortWaves,p/24.).xyz;}
      vec3 displacement(vec2 p){return raw(p)*uSwell*shoreWaveScale(coast(p),uSwell,uWind);}
      vec2 inverseChop(vec2 world){vec2 p=world;for(int i=0;i<3;i++)p=world-displacement(p).xz*uChoppiness;return p;}
      float fftHeight(vec2 world){return displacement(inverseChop(world)).y;}
      float baseHeight(vec2 world){return shoreSolvedSurface(world,fftHeight(world),0.).x;}
      float incidentHeight(vec2 world){return uShoreReady>.5?baseHeight(world):texture2D(uLongWaves,inverseChop(world)/384.).y*uSwell;}
      void main(){
        // Every profile column in a row shares one crest anchor. Independent
        // searches at every grid point made adjacent vertices choose different
        // maxima and stretched the surface into glass-like spikes.
        vec2 uphill=vec2(coast(uOrigin+vec2(2,0)).x-coast(uOrigin-vec2(2,0)).x,coast(uOrigin+vec2(0,2)).x-coast(uOrigin-vec2(0,2)).x);
        float terrainGradient=length(uphill);vec2 n=uphill/max(terrainGradient,.00001);
        vec2 along=vec2(-n.y,n.x),row=uOrigin;
        float depthOffset=0.,previousDepth=-coast(row).x;bool foundDepth=previousDepth>=2.;
        for(int i=1;i<=12;i++){float t=float(i)*2.,currentDepth=-coast(row-n*t).x;if(!foundDepth&&previousDepth<2.&&currentDepth>=2.){depthOffset=t-2.+2.*clamp((2.-previousDepth)/max(.0001,currentDepth-previousDepth),0.,1.);foundDepth=true;}previousDepth=currentDepth;}
        vec2 source=row-n*depthOffset,world=source;
        // A local, current FFT maximum anchors each descending shoulder. A
        // parabola refines the 0.5m search so the crest follows FFT phase.
        float best=-100000.,offset=0.;
        for(int i=0;i<25;i++){float t=float(i)-12.;vec2 candidate=source-n*t;float candidateDepth=-coast(candidate).x,h=incidentHeight(candidate);if(candidateDepth>.2&&candidateDepth<3.8&&h>best){best=h;offset=t;}}
        vec2 peak=source-n*offset;
        float h=incidentHeight(peak),behind=incidentHeight(peak-n*.5),ahead=incidentHeight(peak+n*.5);
        float curvature=(ahead+behind-2.*h)/.25;
        float refine=clamp((ahead-behind)/max(.0001,-curvature),-.25,.25);
        peak+=n*refine;
        // Continue one long-wave ridge across the whole ribbon. Its Hessian
        // gives the local crest tangent; short ripples belong in the optical
        // normal, not in independent macro-crest identities at every row.
        float mixed=incidentHeight(peak+n*.5+along*.5)-incidentHeight(peak+n*.5-along*.5)-incidentHeight(peak-n*.5+along*.5)+incidentHeight(peak-n*.5-along*.5);
        float shear=clamp(-mixed/min(-.0001,curvature),-1.25,1.25);
        peak+=along*position.z+n*shear*position.z;
        h=incidentHeight(peak);behind=incidentHeight(peak-n*.5);ahead=incidentHeight(peak+n*.5);curvature=(ahead+behind-2.*h)/.25;
        vec2 c=coast(peak);float d=-c.x;
        float slope=(h-incidentHeight(peak+n*.75))/.75;
        float energy=uShoreReady>.5?max(whitewaterSolvedFlow(peak).z,whitewaterSolvedFlow(peak+n*.75).z):shoreBreakerDissipation(h/max(.3,uSwell),c,uSwell,uWind);
        // Depth-cap loss is the breaking criterion. Slope and curvature only
        // establish a descending convex front: demanding a steep slope at the
        // maximum itself suppressed broad breaking crests by construction.
        float gate=smoothstep(.2,.6,d)*(1.-smoothstep(2.8,3.8,d))*smoothstep(.02,.25,energy)*smoothstep(.02,.2,h)*smoothstep(.0001,.003,slope)*smoothstep(.00002,.001,-curvature)*clamp(c.y,0.,1.)*smoothstep(.0001,.01,terrainGradient);
        if(!(d>.2&&d<3.8&&c.y>=.18)||abs(offset)>=12.)gate=0.;
        // Radius is local-depth AND actual-crest bounded. No global added wave.
        float radius=min(1.25,min(d*.36,max(0.,h)*.9))*gate;
        float angle=3.665191429;
        float theta=clamp(position.x/SPAN+.5,0.,1.)*angle,q=radius*theta;
        float blend=smoothstep(0.,.18,theta);
        float thick=radius*.25*sheetSide*blend;
        source=peak+n*q;
        float base=baseHeight(source),crest=baseHeight(peak);
        vec2 curled=peak+n*(radius*(1.-cos(theta))-cos(theta)*thick);
        world=mix(source,curled,blend);
        float y=mix(base,crest+radius*sin(theta)+sin(theta)*thick,blend);
        // Source bed/wetness rejects disconnected land sheets; final lip bed
        // clipping is performed independently at its displaced destination.
        if(crest<coast(peak).x+.01||terrainGradient<.00001)gate=0.;
        float edge=abs(position.z);gate*=1.-smoothstep(SPAN*.5-3.,SPAN*.5,edge);
        vec2 delta=world-cameraPosition.xz;y-=dot(delta,delta)/(2.*6371000.);
        vWorld=vec3(world.x,y,world.y);vOcean=inverseChop(source);vDistance=length(cameraPosition-vWorld);vEnvelope=gate;vLip=theta/angle;vWaterThickness=radius*.25;
        gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
      }`.replaceAll('SPAN',SPAN.toFixed(1)),
      fragmentShader:oceanFragment});
    const mesh=new THREE.Mesh(this.geometry,this.material);mesh.frustumCulled=false;mesh.renderOrder=1;this.group.add(mesh);
  }
  /** Root MUST supply the entire ocean material uniform dictionary, including
   * scene depth/color, reflection, sky, solar shadow, solver and atmosphere.
   * Borrow objects, never copy textures or dispose renderer-owned resources. */
  bindUniforms(uniforms:Record<string,THREE.IUniform>):void {
    for(const [name,uniform] of Object.entries(uniforms))if(name!=='uOrigin')this.material.uniforms[name]=uniform;
  }
  update(x:number,z:number,_underwater:boolean):void {
    if(this.disposed)return;
    this.group.visible=Number.isFinite(x)&&Number.isFinite(z);
    if(this.group.visible)(this.material.uniforms.uOrigin.value as THREE.Vector2).set(x,z);
  }
  /** On-demand float probe reuses the exact current vertex driver text. */
  probeDriver(renderer:THREE.WebGLRenderer){
    if(!renderer.extensions.has('EXT_color_buffer_float'))return {available:false};
    const code=this.material.vertexShader,start=code.indexOf('void main(){'),end=code.indexOf('float angle=',start);
    const prefix=code.slice(0,start).replace(/attribute[^;]+;/g,'').replace(/varying[^;]+;/g,'');
    const driver=code.slice(start+'void main(){'.length,end).replaceAll('position.z','rowZ');
    const fragment=prefix+`\nvoid main(){float rowZ=(gl_FragCoord.y-1.5)*8.;${driver}
      float column=floor(gl_FragCoord.x),base=baseHeight(peak),bed=coast(peak).x;
      float envelope=gate*step(bed+.01,base)*(1.-smoothstep(13.,16.,abs(rowZ)));
      if(column<.5)gl_FragColor=vec4(terrainGradient,depthOffset,foundDepth?1.:0.,offset);
      else if(column<25.5)gl_FragColor=vec4(incidentHeight(source-n*(column-13.)),baseHeight(source-n*(column-13.)),coast(source-n*(column-13.)).x,1);
      else if(column<26.5)gl_FragColor=vec4(refine,mixed,shear,curvature);
      else if(column<27.5)gl_FragColor=vec4(d,h,slope,energy);
      else if(column<28.5)gl_FragColor=vec4(envelope,radius,base,bed);
      else gl_FragColor=vec4(peak,n);
    }`;
    const target=new THREE.WebGLRenderTarget(30,3,{type:THREE.FloatType,depthBuffer:false});target.texture.colorSpace=THREE.LinearSRGBColorSpace;
    const material=new THREE.ShaderMaterial({uniforms:this.material.uniforms,depthTest:false,depthWrite:false,toneMapped:false,vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:fragment});
    const geometry=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene();scene.add(new THREE.Mesh(geometry,material));
    const saved={target:renderer.getRenderTarget(),viewport:renderer.getViewport(new THREE.Vector4()),scissor:renderer.getScissor(new THREE.Vector4()),scissorTest:renderer.getScissorTest(),auto:renderer.autoClear,clear:renderer.getClearColor(new THREE.Color()),alpha:renderer.getClearAlpha()};
    const pixels=new Float32Array(30*3*4);
    try{renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.setViewport(0,0,30,3);renderer.autoClear=true;renderer.setClearColor(0,0);renderer.render(scene,new THREE.Camera());renderer.readRenderTargetPixels(target,0,0,30,3,pixels);return {available:true,origin:(this.material.uniforms.uOrigin.value as THREE.Vector2).toArray(),rows:[-8,0,8].map((z,i)=>({z,values:Array.from({length:30},(_,j)=>Array.from(pixels.slice((i*30+j)*4,(i*30+j+1)*4)))}))};}
    finally{renderer.setRenderTarget(saved.target);renderer.setViewport(saved.viewport);renderer.setScissor(saved.scissor);renderer.setScissorTest(saved.scissorTest);renderer.autoClear=saved.auto;renderer.setClearColor(saved.clear,saved.alpha);target.dispose();material.dispose();geometry.dispose();}
  }
  dispose():void {if(this.disposed)return;this.disposed=true;this.geometry.dispose();this.material.dispose();this.group.clear();}
}
