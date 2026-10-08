import * as THREE from 'three';
import { shoreWaveSampling, shoreBreakerDissipationSampling } from './surface-detail.ts';
import { shoreSolverSampling, createShoreSolverUniforms } from './shore-solver.ts';
import { oceanFragment } from './shaders.ts';
import {whitewaterFlowSampling} from './whitewater-flow.ts';
import {ShoreFront} from './shore-front.ts';

const SEGMENTS=96, SPAN=32;
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/** CPU mirror of the sheet gate, for boundedness and negative-path checks. */
export function breakerSheetEnvelope(depth:number,energy:number,crest:number,slope:number,curvature:number,shelter:number):number {
  if(![depth,energy,crest,slope,curvature,shelter].every(Number.isFinite)||depth<=.2||depth>=3.8||shelter<.18)return 0;
  return smooth(.2,.6,depth)*(1-smooth(2.8,3.8,depth))*smooth(.02,.25,energy)*smooth(.02,.2,crest)*smooth(.0001,.003,slope)*smooth(.00002,.001,-curvature)*Math.min(1,shelter);
}

/** Historical 4m upstream-search diagnostic, not either current GPU driver.
 * This CPU helper does not establish production front identity or continuity. */
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

/** Kinematic bilayer over the shared SWE base. The renderer-backed candidate
 * uses persistent GPU front descriptors; the legacy driver remains for A/B. */
export class ShoreBreaker {
  readonly group=new THREE.Group();
  readonly material:THREE.ShaderMaterial;
  readonly triangleCount:number;
  private readonly geometry:THREE.BufferGeometry;
  private readonly front:ShoreFront|null;
  private disposed=false;
  constructor(renderer?:THREE.WebGLRenderer,tracked=true){
    const closed=!!renderer&&tracked;
    this.triangleCount=SEGMENTS*SEGMENTS*4+(closed?SEGMENTS*8:0);
    const plane=new THREE.PlaneGeometry(SPAN,SPAN,SEGMENTS,SEGMENTS);plane.rotateX(-Math.PI/2);
    const a=plane.getAttribute('position'),count=a.count;
    const positions=new Float32Array(count*6),sides=new Float32Array(count*2);
    for(let i=0;i<count;i++)for(let j=0;j<2;j++){
      const k=i+j*count;positions[k*3]=a.getX(i);positions[k*3+2]=a.getZ(i);sides[k]=j===0?.5:-.5;
    }
    const original=plane.index!,indices=new Uint32Array(this.triangleCount*3);
    for(let i=0;i<original.count;i+=3){
      indices.set([original.getX(i),original.getX(i+1),original.getX(i+2)],i);
      indices.set([original.getX(i+2)+count,original.getX(i+1)+count,original.getX(i)+count],original.count+i);
    }
    if(closed){
      const stride=SEGMENTS+1,boundary:number[]=[];
      for(let x=0;x<SEGMENTS;x++)boundary.push(x);
      for(let z=0;z<SEGMENTS;z++)boundary.push(z*stride+SEGMENTS);
      for(let x=SEGMENTS;x>0;x--)boundary.push(SEGMENTS*stride+x);
      for(let z=SEGMENTS;z>0;z--)boundary.push(z*stride);
      for(let i=0;i<boundary.length;i++){
        const a=boundary[i],b=boundary[(i+1)%boundary.length];
        indices.set([a,b,b+count,a,b+count,a+count],original.count*2+i*6);
      }
    }
    this.geometry=new THREE.BufferGeometry();this.geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    this.geometry.setAttribute('sheetSide',new THREE.BufferAttribute(sides,1));this.geometry.setIndex(new THREE.BufferAttribute(indices,1));plane.dispose();
    this.material=new THREE.ShaderMaterial({depthWrite:true,depthTest:true,side:closed?THREE.FrontSide:THREE.DoubleSide,defines:{CURVED_SURFACE:1},
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
    const code=this.material.vertexShader,start=code.indexOf('void main(){'),end=code.indexOf('float angle=',start);
    const sampling=code.slice(0,start).replace(/attribute[^;]+;/g,'').replace(/varying[^;]+;/g,'');
    this.front=renderer&&tracked?new ShoreFront(renderer,sampling,this.material.uniforms,SEGMENTS+1,SPAN,true):null;
    if(this.front){
      Object.assign(this.material.uniforms,this.front.uniforms);
      this.material.vertexShader=code.slice(0,start)+`
        uniform sampler2D uFrontPosition,uFrontMotion,uFrontShape;
        uniform float uFrontCount,uFrontReady;
        void main(){
          float index=(position.z/${SPAN.toFixed(1)}+.5)*(uFrontCount-1.);
          vec2 uv=vec2((index+.5)/uFrontCount,.5);
          vec4 point=texture2D(uFrontPosition,uv),motion=texture2D(uFrontMotion,uv),shape=texture2D(uFrontShape,uv);
          vec2 peak=point.xy,n=length(motion.xy)>.5?normalize(motion.xy):vec2(1,0),source=peak,world=peak;
          float terrainGradient=1.,gate=shape.x*shape.w*uFrontReady,radius=shape.y*uFrontReady;
          // Reconstruct a connected line, not independent sharp per-row fins.
          // Never smooth across a different wave identity or a large spatial gap.
          vec2 positionSum=vec2(0),normalSum=vec2(0);float weightSum=0.,radiusSum=0.,strengthSum=0.;
          for(int j=-2;j<=2;j++){
            float k=clamp(index+float(j),0.,uFrontCount-1.);vec2 tap=vec2((k+.5)/uFrontCount,.5);
            vec4 p=texture2D(uFrontPosition,tap),m=texture2D(uFrontMotion,tap),s=texture2D(uFrontShape,tap);
            if(point.w>.5&&p.w==point.w&&s.w>.5&&distance(p.xy,point.xy)<2.){
              float weight=3.-abs(float(j));weightSum+=weight;positionSum+=p.xy*weight;normalSum+=m.xy*weight;
              radiusSum+=s.y*weight;strengthSum+=s.x*weight;
            }
          }
          if(weightSum>0.){
            peak=positionSum/weightSum;n=normalize(normalSum);radius=radiusSum/weightSum;
            gate=strengthSum/weightSum*min(1.,weightSum/9.)*uFrontReady;
          }
          float resolved=smoothstep(.006,.018,radius);
          radius*=resolved*(1.-smoothstep(13.,16.,abs(position.z)));gate*=resolved;
          // Never connect different front identities or bridge a retired row.
          float adjacent=index<uFrontCount-1.?index+1.:index-1.;
          vec4 neighbor=texture2D(uFrontPosition,vec2((adjacent+.5)/uFrontCount,.5));
          if(point.w<.5||neighbor.w!=point.w||distance(neighbor.xy,point.xy)>1.5){gate=0.;radius=0.;}
      `+code.slice(end).replace('float blend=smoothstep(0.,.18,theta);','float blend=smoothstep(0.,.18,theta)*(1.-smoothstep(.80,1.,theta/angle));');
    }
  }
  /** Root MUST supply the entire ocean material uniform dictionary, including
   * scene depth/color, reflection, sky, solar shadow, solver and atmosphere.
   * Borrow objects, never copy textures or dispose renderer-owned resources. */
  bindUniforms(uniforms:Record<string,THREE.IUniform>):void {
    for(const [name,uniform] of Object.entries(uniforms))if(name!=='uOrigin'&&!name.startsWith('uFront'))this.material.uniforms[name]=uniform;
    this.front?.bindUniforms(uniforms);
  }
  update(x:number,z:number,_underwater:boolean,seconds=0,time=0):void {
    if(this.disposed)return;
    this.group.visible=Number.isFinite(x)&&Number.isFinite(z);
    if(this.group.visible)(this.material.uniforms.uOrigin.value as THREE.Vector2).set(x,z);
    this.front?.update(seconds,time,x,z);
  }
  /** On-demand float probe reuses the exact current vertex driver text. */
  probeDriver(renderer:THREE.WebGLRenderer,expanded=false){
    if(this.front)return this.front.probe();
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
    // Optional observation is wholly on demand; all formulas below are extracted
    // from the production sampling strings, not a second physical closure.
    const compression=whitewaterFlowSampling.slice(whitewaterFlowSampling.indexOf('float compression='),whitewaterFlowSampling.indexOf('float born='));
    const surface=shoreSolverSampling.slice(shoreSolverSampling.indexOf('vec2 shoreSolvedSurface(')).replace('shoreSolvedSurface(', 'diagnosticSurface(').replace('return mix(vec2(fallbackHeight,fallbackFoam),surface,blend);','diagnosticSurfaceHeight=surface.x;diagnosticConfidence=weighted.z;diagnosticBlend=blend;return mix(vec2(fallbackHeight,fallbackFoam),surface,blend);');
    const profileFragment=expanded?prefix+`\nfloat diagnosticSurfaceHeight,diagnosticConfidence,diagnosticBlend;${surface}
    void main(){float rowZ=(gl_FragCoord.y-1.5)*8.;${driver}{
      float lane=floor(gl_FragCoord.x/65.),index=mod(floor(gl_FragCoord.x),65.),crossOffset=(index-32.)*1.5;
      vec2 p=source-n*crossOffset+along*rowZ;
      vec2 uv=(p-uShoreBounds.xy)/uShoreBounds.zw,buv=(p-uBathyBounds.xy)/uBathyBounds.zw,e=vec2(1./uShoreResolution,0);
      bool bathyValid=all(greaterThanEqual(buv,vec2(0)))&&all(lessThanEqual(buv,vec2(1)));
      bool domainValid=uShoreReady>.5&&all(greaterThanEqual(uv,vec2(0)))&&all(lessThanEqual(uv,vec2(1)));
      bool stencilValid=domainValid&&all(greaterThanEqual(uv,e.xx))&&all(lessThanEqual(uv,vec2(1)-e.xx));
      vec2 coast=bathyValid?sampleCoastalGround(uBathymetry,buv,uBathyResolution).rg:vec2(0);
      vec4 c=vec4(0),r=vec4(0),l=vec4(0),t=vec4(0),b=vec4(0);
      if(domainValid)c=texture2D(uShoreState,uv);
      if(stencilValid){r=texture2D(uShoreState,uv+e);l=texture2D(uShoreState,uv-e);t=texture2D(uShoreState,uv+e.yx);b=texture2D(uShoreState,uv-e.yx);}
      vec2 cellSize=uShoreBounds.zw/uShoreResolution;${compression}
      if(!stencilValid)compression=0.;
      float elevation=c.r+coast.r,restDepth=max(0.,-coast.r),ratio=2.*max(0.,elevation)/max(.2,restDepth);
      float born=whitewaterSolvedFlow(p).z;
      diagnosticSurfaceHeight=0.;diagnosticConfidence=0.;diagnosticBlend=0.;
      float renderedHeight=diagnosticSurface(p,fftHeight(p),0.).x;
      float incident=incidentHeight(p),previous=incidentHeight(p+n*1.5),next=incidentHeight(p-n*1.5);
      bool flowValid=bathyValid&&stencilValid&&coast.g>=.18&&c.r>=.01;
      if(lane<.5)gl_FragColor=vec4(p,crossOffset,rowZ);
      else if(lane<1.5)gl_FragColor=vec4(bathyValid?1.:0.,domainValid?1.:0.,stencilValid?1.:0.,flowValid?1.:0.);
      else if(lane<2.5)gl_FragColor=vec4(c.r,c.y,c.z,elevation);
      else if(lane<3.5)gl_FragColor=vec4(compression,ratio,born,whitewaterSolvedFlow(p).w);
      else if(lane<4.5)gl_FragColor=vec4(renderedHeight,incident,diagnosticSurfaceHeight,fftHeight(p));
      else if(lane<5.5)gl_FragColor=vec4(diagnosticConfidence,diagnosticBlend,coast.r,coast.g);
      else if(lane<6.5)gl_FragColor=vec4(clamp(compression*.7,0.,1.),1.-smoothstep(3.,7.,c.r),smoothstep(.05,.3,c.r),smoothstep(.55,.9,ratio));
      else gl_FragColor=vec4(previous,next,incident>=previous&&incident>=next?1.:0.,abs(offset)>=12.?1.:0.);
    }}`:'';
    const profileTarget=expanded?new THREE.WebGLRenderTarget(65*8,3,{type:THREE.FloatType,depthBuffer:false}):null;
    if(profileTarget)profileTarget.texture.colorSpace=THREE.LinearSRGBColorSpace;
    const profileMaterial=expanded?new THREE.ShaderMaterial({uniforms:this.material.uniforms,depthTest:false,depthWrite:false,toneMapped:false,vertexShader:material.vertexShader,fragmentShader:profileFragment}):null;
    const profilePixels=expanded?new Float32Array(65*8*3*4):null;
    try{
      renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.autoClear=true;renderer.setClearColor(0,0);
      renderer.render(scene,new THREE.Camera());renderer.readRenderTargetPixels(target,0,0,30,3,pixels);
      let profile;
      if(profileTarget&&profileMaterial&&profilePixels){
        (scene.children[0] as THREE.Mesh).material=profileMaterial;
        renderer.setRenderTarget(profileTarget);
        renderer.render(scene,new THREE.Camera());renderer.readRenderTargetPixels(profileTarget,0,0,65*8,3,profilePixels);
        // These metric coordinates are independent of water state. A failed
        // program can otherwise silently return zeros and look like calm water.
        for(let row=0;row<3;row++)for(let index=0;index<65;index++){
          const start=(row*65*8+index)*4;
          if(profilePixels[start+2]!==((index-32)*1.5)||profilePixels[start+3]!==((row-1)*8))throw new Error('Expanded crest probe returned invalid coordinate channels; check GPU compilation/readback');
        }
        profile={schemaVersion:1,coordinate:'worldXZ = depthCrossingSource - uphillNormal * crossOffsetM + alongshoreTangent * rowOffsetM; independent parallel rows, no crest shear',cellSpacingM:1.5,
          channels:['worldX_M','worldZ_M','crossOffsetM','rowOffsetM','bathyValid','solverDomainValid','solverStencilValid','flowBirthValid','nearestDepthM','nearestQx_M2PerS','nearestQz_M2PerS','nearestElevationM','rawCompressionPerS','birthHeightDepthRatio','bornProxy','flowBlend','renderedSurfaceHeightM','incidentHeightM','bilinearWetSurfaceHeightM','fftHeightM','bilinearWetConfidence','surfaceBlend','groundHeightM','shelter','compressionOnsetGate','deepBirthGate','wetBirthGate','ratioBirthGate','previousIncidentHeightM','nextIncidentHeightM','profileLocalMaximum','driverEndpointRejected'],
          rows:[-8,0,8].map((rowOffsetM,rowIndex)=>({rowOffsetM,samples:Array.from({length:65},(_,index)=>Array.from({length:8},(_,lane)=>Array.from(profilePixels.slice(((rowIndex*65*8)+lane*65+index)*4,((rowIndex*65*8)+lane*65+index+1)*4))).flat())}))};
      }
      return {available:true,origin:(this.material.uniforms.uOrigin.value as THREE.Vector2).toArray(),rows:[-8,0,8].map((z,i)=>({z,values:Array.from({length:30},(_,j)=>Array.from(pixels.slice((i*30+j)*4,(i*30+j+1)*4)))})),...(profile?{profile}:{})};
    }
    finally{renderer.setRenderTarget(saved.target);renderer.setViewport(saved.viewport);renderer.setScissor(saved.scissor);renderer.setScissorTest(saved.scissorTest);renderer.autoClear=saved.auto;renderer.setClearColor(saved.clear,saved.alpha);target.dispose();material.dispose();geometry.dispose();profileTarget?.dispose();profileMaterial?.dispose();}
  }

  get diagnostics(){return {tracked:!!this.front,triangles:this.triangleCount,front:this.front?.diagnostics??null,scope:'Opt-in kinematic sheet; visual acceptance pending'};}
  dispose():void {if(this.disposed)return;this.disposed=true;this.front?.dispose();this.geometry.dispose();this.material.dispose();this.group.clear();}
}
