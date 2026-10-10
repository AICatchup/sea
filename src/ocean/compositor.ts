import * as THREE from 'three';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import {waterVolumeGLSL} from './water-volume.ts';

/** Metres along a normalized view ray; depth is camera-axis distance. */
export function underwaterRayDistance(axisDistance: number, forwardCosine: number): number {
  return Math.max(0, axisDistance) / Math.max(1e-6, Math.abs(forwardCosine));
}

/** Beer-Lambert transmission is never clipped to an artistic visibility radius. */
export function underwaterTransmission(path: number, extinction: number): number {
  return Math.exp(-Math.max(0, extinction) * Math.max(0, path));
}

export interface DepthProbePoint { readonly x: number; readonly y: number }
export interface DepthProbeSample extends DepthProbePoint {
  landDepth: number; waterDepth: number; waterAlpha: number;
}
export function validateDepthProbePoints(points: readonly DepthProbePoint[]): void {
  if (points.length > 8) throw new RangeError('Depth probe accepts at most 8 UV points');
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)
      throw new RangeError('Depth probe UV coordinates must be finite and in [0,1]');
  }
}

const vertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;
const occlusionFragment = /* glsl */ `
 precision highp float;
 varying vec2 vUv;
 uniform sampler2D uDepth;
 uniform mat4 uInverseProjection;
 uniform vec2 uFullResolution;
 vec3 viewPosition(vec2 uv){
   float d=texture2D(uDepth,uv).r;
   vec4 p=uInverseProjection*vec4(uv*2.0-1.0,d*2.0-1.0,1.0);
   return p.xyz/p.w;
 }
 void main(){
   float depth=texture2D(uDepth,vUv).r;
   if(depth>.999999){gl_FragColor=vec4(1.0,35000.0,0.0,1.0);return;}
   vec3 p=viewPosition(vUv);
   vec2 pixel=1.0/uFullResolution;
   vec3 left=p-viewPosition(vUv-vec2(pixel.x,0)),right=viewPosition(vUv+vec2(pixel.x,0))-p;
   vec3 down=p-viewPosition(vUv-vec2(0,pixel.y)),up=viewPosition(vUv+vec2(0,pixel.y))-p;
   // Choose the tangent on the same side of a depth discontinuity. This keeps
   // sky silhouettes from creating invented normals and broad dark halos.
   vec3 dx=abs(left.z)<abs(right.z)?left:right;
   vec3 dy=abs(down.z)<abs(up.z)?down:up;
   vec3 n=normalize(cross(dx,dy));if(dot(n,-p)<0.0)n=-n;
   const float radius=1.25;
   float pixelRadius=clamp(radius/max(length(dx),length(dy)),2.0,85.0);
   float angle=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)*6.2831853;
   float obscurance=0.0;
   for(int i=0;i<8;i++){
     float a=angle+float(i)*.78539816;vec2 axis=vec2(cos(a),sin(a));
     for(int j=0;j<2;j++){
       float fraction=(float(j)+.55)/2.0;
       vec2 sampleUv=vUv+axis*pixel*pixelRadius*fraction;
       if(any(lessThan(sampleUv,vec2(0)))||any(greaterThan(sampleUv,vec2(1))))continue;
       vec3 delta=viewPosition(sampleUv)-p;float lengthSquared=dot(delta,delta);
       float falloff=pow(max(0.0,1.0-lengthSquared/(radius*radius)),2.0);
       float horizon=max(0.0,dot(n,delta)*inversesqrt(max(lengthSquared,.0001))-.08);
       obscurance+=horizon*falloff;
     }
   }
   float ao=clamp(1.0-obscurance*.22,.48,1.0);
   gl_FragColor=vec4(ao,-p.z,0.0,1.0);
 }`;
const mergeFragment = `
 precision highp float;
 ${waterVolumeGLSL}
 varying vec2 vUv;
 uniform sampler2D uLand, uWater, uLandDepth, uWaterDepth, uOcclusion;
 uniform float uExposure, uUnderwater, uTime, uGrade;
 uniform vec2 uNearFar, uOcclusionPixel, uSunShadowTexel;
 uniform sampler2DShadow uSunShadow;
 uniform mat4 uSunShadowMatrix, uCameraWorld, uInverseProjection;
 uniform vec3 uSunDirection, uSunColor, uCameraPosition;
 uniform float uShadowReady;
 float solarVisibility(vec3 point){
   if(uShadowReady<.5)return 1.0;
   vec4 projected=uSunShadowMatrix*vec4(point,1.0);vec3 q=projected.xyz/projected.w;
   if(any(lessThan(q.xy,vec2(.001)))||any(greaterThan(q.xy,vec2(.999))))return 1.0;
   if(q.z<0.0||q.z>1.0)return 1.0;
   float depth=q.z-.00013;vec2 stepUV=uSunShadowTexel*.75;
   return .25*(texture(uSunShadow,vec3(q.xy+stepUV,depth))
     +texture(uSunShadow,vec3(q.xy-stepUV,depth))
     +texture(uSunShadow,vec3(q.xy+vec2(stepUV.x,-stepUV.y),depth))
     +texture(uSunShadow,vec3(q.xy+vec2(-stepUV.x,stepUV.y),depth)));
 }
 float viewDistance(float d){float n=uNearFar.x,f=uNearFar.y;return 2.0*n*f/(f+n-(d*2.0-1.0)*(f-n));}
 float contactOcclusion(){
   float centerDepth=viewDistance(texture2D(uLandDepth,vUv).r);
   float sum=0.0,weightSum=0.0;
   for(int i=0;i<5;i++){
     vec2 offset=i==0?vec2(0):i==1?vec2(1,0):i==2?vec2(-1,0):i==3?vec2(0,1):vec2(0,-1);
     vec2 aoSample=texture2D(uOcclusion,vUv+offset*uOcclusionPixel).rg;
     float w=exp(-abs(aoSample.y-centerDepth)/max(.15,centerDepth*.012))*(i==0?2.0:1.0);
     sum+=aoSample.x*w;weightSum+=w;
   }
   return sum/max(weightSum,.00001);
 }
 void main(){
   vec4 water=texture2D(uWater,vUv);
   vec3 color=mix(texture2D(uLand,vUv).rgb*contactOcclusion(),water.rgb,water.a);
   float depth=mix(texture2D(uLandDepth,vUv).r,texture2D(uWaterDepth,vUv).r,water.a);
   if(uUnderwater>0.0){
     vec4 viewPoint=uInverseProjection*vec4(vUv*2.0-1.0,1.0,1.0);
     vec3 viewRay=normalize(viewPoint.xyz/viewPoint.w);
     vec3 ray=normalize(mat3(uCameraWorld)*viewRay);
     // The selected depth is the actual waved/curved interface or opaque hit.
     // A y=0 plane is NOT that interface: capping there leaks the un-refracted
     // background through gaps beyond the finite ocean mesh near the horizon.
     float path=max(0.0,viewDistance(depth)/max(.000001,-viewRay.z));
     // Metres and linear radiance. Clear coastal water preserves close reds
     // and contrast; long water paths progressively remove warm wavelengths.
     vec3 extinction=vec3(.105,.021,.012);
     vec3 transmission=exp(-extinction*path);
     vec3 refractedSun=-refract(-uSunDirection,vec3(0,1,0),.75019);
     float phase=(1.0-.76*.76)/pow(max(.035,1.0+.76*.76-2.0*.76*dot(ray,refractedSun)),1.5);
     // Integrate both optical paths in fixed metric shadow cells. Retain an
     // analytic, unshadowed distant tail after the last cell at 510m.
     vec3 volume=vec3(0.0);float sunCos=max(.35,refractedSun.y);
     float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(73.156,52.235)))*43758.5453);
     for(int i=0;i<8;i++){
       float a=waterShadowCellStart(i),b=min(path,waterShadowCellStart(i+1));
       if(a>=path)break;
       float distance=mix(a,b,.25+jitter*.5);
       vec3 point=uCameraPosition+ray*distance;
       float visibility=solarVisibility(point);
       volume+=waterLightIntegral(a,b,uCameraPosition.y,ray.y,sunCos,extinction)*visibility;
     }
     if(path>510.0)volume+=waterLightIntegral(510.0,path,uCameraPosition.y,ray.y,sunCos,extinction);
     volume*=vec3(.0008,.0028,.0041)*uSunColor*(.12+phase*.12);
     vec3 scatter=vec3(.003,.026,.041);
     vec3 underwater=color*transmission+scatter*(1.0-transmission)+volume;
     color=mix(color,underwater,uUnderwater);
   }
   color*=uExposure;
   // Photographic grade: hand linear HDR to the bloom and finish passes.
   if(uGrade>.5){gl_FragColor=vec4(color,1.0);return;}
   color=clamp((color*(2.51*color+0.03))/(color*(2.43*color+0.59)+0.14),0.0,1.0);
   // Exactly one display transform, after HDR optics and contact occlusion.
   color=mix(color*12.92,1.055*pow(color,vec3(1.0/2.4))-.055,step(vec3(.0031308),color));
   // Tiny ordered film-grain dither removes banding without a texture download.
   float grain=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-0.5;
   color+=grain/650.0;
   if(uUnderwater>0.0){
     vec2 p=vUv*2.0-1.0;
     float edge=smoothstep(0.52,1.2,length(p*vec2(0.80,1.0)));
     color*=1.0-edge*0.10*uUnderwater;
   }
   gl_FragColor=vec4(color,1.0);
 }`;

// ?grade=photo candidate. Bright-pass-free dual-filter bloom (Karis-weighted first
// level so isolated sun glints cannot flicker), then AgX with a mild look in place of
// the ACES fit, film grain and a slight lens fall-off. Exposure/look values were picked
// from side-by-side stills against the default (not a measured camera calibration).
const downFragment=/* glsl */`
 precision highp float;varying vec2 vUv;uniform sampler2D uSource;uniform vec2 uTexel;uniform float uKaris;
 float weight(vec3 c){return uKaris>.5?1.0/(1.0+dot(c,vec3(.2126,.7152,.0722))):1.0;}
 void main(){
   vec3 a=texture2D(uSource,vUv+uTexel*vec2(-1,-1)).rgb,b=texture2D(uSource,vUv+uTexel*vec2(1,-1)).rgb;
   vec3 c=texture2D(uSource,vUv+uTexel*vec2(-1,1)).rgb,d=texture2D(uSource,vUv+uTexel*vec2(1,1)).rgb;
   float wa=weight(a),wb=weight(b),wc=weight(c),wd=weight(d);
   gl_FragColor=vec4((a*wa+b*wb+c*wc+d*wd)/(wa+wb+wc+wd),1.0);
 }`;
const upFragment=/* glsl */`
 precision highp float;varying vec2 vUv;uniform sampler2D uSource;uniform vec2 uTexel;
 void main(){
   vec3 s=texture2D(uSource,vUv).rgb*4.0;
   s+=(texture2D(uSource,vUv+uTexel*vec2(-1,0)).rgb+texture2D(uSource,vUv+uTexel*vec2(1,0)).rgb+texture2D(uSource,vUv+uTexel*vec2(0,-1)).rgb+texture2D(uSource,vUv+uTexel*vec2(0,1)).rgb)*2.0;
   s+=texture2D(uSource,vUv+uTexel*vec2(-1,-1)).rgb+texture2D(uSource,vUv+uTexel*vec2(1,-1)).rgb+texture2D(uSource,vUv+uTexel*vec2(-1,1)).rgb+texture2D(uSource,vUv+uTexel*vec2(1,1)).rgb;
   gl_FragColor=vec4(s/16.0,1.0);
 }`;
const finishFragment=/* glsl */`
 precision highp float;varying vec2 vUv;uniform sampler2D uHdr,uBloom;uniform float uBloomMix,uGradeExposure,uVignette,uUnderwater,uLookPower,uLookSaturation;
 const mat3 SRGB_TO_2020=mat3(vec3(.6274,.0691,.0164),vec3(.3293,.9195,.0880),vec3(.0433,.0113,.8956));
 const mat3 REC2020_TO_SRGB=mat3(vec3(1.6605,-.1246,-.0182),vec3(-.5876,1.1329,-.1006),vec3(-.0728,-.0083,1.1187));
 const mat3 INSET=mat3(vec3(.856627153315983,.137318972929847,.11189821299995),vec3(.0951212405381588,.761241990602591,.0767994186031903),vec3(.0482516061458583,.101439036467562,.811302368396859));
 const mat3 OUTSET=mat3(vec3(1.1271005818144368,-.1413297634984383,-.14132976349843826),vec3(-.11060664309660323,1.157823702216272,-.11060664309660294),vec3(-.016493938717834573,-.016493938717834257,1.2519364065950405));
 vec3 contrast(vec3 x){vec3 x2=x*x,x4=x2*x2;return 15.5*x4*x2-40.14*x4*x+31.96*x4-6.868*x2*x+.4298*x2+.1191*x-.00232;}
 // AgX (Blender/Filament, as in three's tone-mapping chunk) with a mild power/saturation look.
 vec3 agx(vec3 c){
   c=INSET*(SRGB_TO_2020*c);c=clamp((log2(max(c,1e-10))+12.47393)/16.5,0.0,1.0);c=contrast(c);
   float luma=dot(c,vec3(.2126,.7152,.0722));c=pow(max(c,0.0),vec3(uLookPower));c=luma+uLookSaturation*(c-luma);
   c=OUTSET*c;c=pow(max(c,0.0),vec3(2.2));return clamp(REC2020_TO_SRGB*c,0.0,1.0);
 }
 void main(){
   vec3 hdr=mix(texture2D(uHdr,vUv).rgb,texture2D(uBloom,vUv).rgb,uBloomMix);
   vec2 p=vUv*2.0-1.0;
   hdr*=1.0-uVignette*smoothstep(.35,1.45,dot(p*vec2(.86,1.0),p*vec2(.86,1.0)));
   vec3 color=agx(hdr*uGradeExposure);
   color=mix(color*12.92,1.055*pow(color,vec3(1.0/2.4))-.055,step(vec3(.0031308),color));
   color+=(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/650.0;
   if(uUnderwater>0.0)color*=1.0-smoothstep(0.52,1.2,length(p*vec2(.80,1.0)))*.10*uUnderwater;
   gl_FragColor=vec4(color,1.0);
 }`;

/** Separate opaque-scene and water buffers make depth-tested refraction possible. */
export class SceneCompositor {
  readonly landTarget: THREE.WebGLRenderTarget;
  readonly waterTarget: THREE.WebGLRenderTarget;
  readonly occlusionTarget = new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false});
  readonly shadowUniforms:Record<string,THREE.IUniform>={
    uSunShadow:{value:null},uSunShadowMatrix:{value:new THREE.Matrix4()},
    uSunShadowTexel:{value:new THREE.Vector2(1/2048,1/2048)},uShadowReady:{value:0},
  };
  private readonly colorTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly merge: THREE.ShaderMaterial;
  private readonly occlusion:THREE.ShaderMaterial;
  private readonly fxaa = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms),
    vertexShader: vertex,
    fragmentShader: FXAAShader.fragmentShader.replace('return texture( tex2D, uv );','return textureLod( tex2D, uv, 0.0 );'),
    depthTest: false, depthWrite: false, toneMapped: false });
  private readonly quad: THREE.Mesh;
  private sunlight:THREE.DirectionalLight|null=null;
  /** Optional photographic grade (?grade=photo): HDR target, bloom chain and finish pass. */
  private grade:{hdr:THREE.WebGLRenderTarget;mips:THREE.WebGLRenderTarget[];down:THREE.ShaderMaterial;up:THREE.ShaderMaterial;finish:THREE.ShaderMaterial}|null=null;

  private readonly renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer, exposure: THREE.IUniform, underwater: THREE.IUniform, time: THREE.IUniform) {
    this.renderer = renderer;
    const target = () => {
      const value = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true });
      value.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
      return value;
    };
    this.landTarget = target(); this.waterTarget = target();
    this.occlusion=new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:occlusionFragment,
      depthTest:false,depthWrite:false,toneMapped:false,uniforms:{uDepth:{value:this.landTarget.depthTexture},
        uInverseProjection:{value:new THREE.Matrix4()},uFullResolution:{value:new THREE.Vector2(1,1)}}});
    this.merge = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: mergeFragment,
      depthTest:false,depthWrite:false,toneMapped:false,
      uniforms:{uLand:{value:this.landTarget.texture},uWater:{value:this.waterTarget.texture},
        uLandDepth:{value:this.landTarget.depthTexture},uWaterDepth:{value:this.waterTarget.depthTexture},
        uOcclusion:{value:this.occlusionTarget.texture},uOcclusionPixel:{value:new THREE.Vector2(1,1)},
        uExposure:exposure,uUnderwater:underwater,uTime:time,uNearFar:{value:new THREE.Vector2(.12,35000)},
        ...this.shadowUniforms,uCameraWorld:{value:new THREE.Matrix4()},
        uInverseProjection:{value:new THREE.Matrix4()},uCameraPosition:{value:new THREE.Vector3()},uSunDirection:{value:new THREE.Vector3(0,1,0)},
        uSunColor:{value:new THREE.Vector3(1,1,1)}} });
    this.quad = new THREE.Mesh(this.geometry, this.merge);
    this.quad.frustumCulled = false; this.scene.add(this.quad);
    this.fxaa.uniforms.tDiffuse.value = this.colorTarget.texture;
    this.merge.uniforms.uGrade={value:0};
  }

  /** Enables the photographic grade candidate; the default ACES path is untouched when off. */
  enableGrade():void{
    if(this.grade)return;
    const hdr=()=>new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
    const pass=(fragmentShader:string,uniforms:Record<string,THREE.IUniform>,blending:THREE.Blending=THREE.NoBlending)=>new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader,uniforms,depthTest:false,depthWrite:false,toneMapped:false,blending});
    this.grade={hdr:hdr(),mips:Array.from({length:6},hdr),
      down:pass(downFragment,{uSource:{value:null},uTexel:{value:new THREE.Vector2()},uKaris:{value:0}}),
      // Additive tent upsampling accumulates every coarser level into the finer one.
      up:pass(upFragment,{uSource:{value:null},uTexel:{value:new THREE.Vector2()}},THREE.AdditiveBlending),
      finish:pass(finishFragment,{uHdr:{value:null},uBloom:{value:null},uBloomMix:{value:.01},uGradeExposure:{value:1.5},uVignette:{value:.16},uLookPower:{value:1.25},uLookSaturation:{value:1.35},uUnderwater:this.merge.uniforms.uUnderwater})};
    this.merge.uniforms.uGrade.value=1;
    this.resize(this.colorTarget.width,this.colorTarget.height);
  }
  get gradeEnabled():boolean{return this.grade!==null;}

  /** QA only: UV origin is bottom-left. Samples the most recently rendered buffers. */
  async probeDepthSamples(points: readonly DepthProbePoint[]): Promise<DepthProbeSample[]> {
    validateDepthProbePoints(points);
    if (points.length === 0) return [];
    if (!this.renderer.extensions.has('EXT_color_buffer_float'))
      throw new Error('Depth probe requires EXT_color_buffer_float');
    // Capture caller data before the asynchronous read, so it cannot change labels.
    const samples = points.map(p => ({x:p.x,y:p.y}));
    const target = new THREE.WebGLRenderTarget(samples.length,1,{
      type:THREE.FloatType,format:THREE.RGBAFormat,depthBuffer:false,
      minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
    const material = new THREE.ShaderMaterial({vertexShader:vertex,
      fragmentShader:`precision highp float;
        uniform sampler2D uLandDepth,uWaterDepth,uWater;
        uniform vec2 uPoints[8];
        void main(){
          int index=int(gl_FragCoord.x);
          vec2 uv=uPoints[index];
          gl_FragColor=vec4(texture2D(uLandDepth,uv).r,
            texture2D(uWaterDepth,uv).r,texture2D(uWater,uv).a,1.0);
        }`,depthTest:false,depthWrite:false,toneMapped:false,
      uniforms:{uLandDepth:{value:this.landTarget.depthTexture},
        uWaterDepth:{value:this.waterTarget.depthTexture},uWater:{value:this.waterTarget.texture},
        uPoints:{value:Array.from({length:8},(_,i)=>new THREE.Vector2(samples[i]?.x??0,samples[i]?.y??0))}}});
    const geometry = new THREE.PlaneGeometry(2,2);
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);
    const renderer=this.renderer, previousTarget=renderer.getRenderTarget();
    const previousFace=renderer.getActiveCubeFace(),previousMip=renderer.getActiveMipmapLevel();
    const viewport=renderer.getViewport(new THREE.Vector4());
    const scissor=renderer.getScissor(new THREE.Vector4()),scissorTest=renderer.getScissorTest();
    const previousAutoClear=renderer.autoClear;
    const data=new Float32Array(samples.length*4);
    let pending: Promise<unknown>;
    try {
      renderer.autoClear=false;
      renderer.setRenderTarget(target);
      renderer.setScissorTest(false);renderer.render(scene,this.camera);
      pending=renderer.readRenderTargetPixelsAsync(target,0,0,samples.length,1,data);
    } catch(error) {
      target.dispose();geometry.dispose();material.dispose();throw error;
    } finally {
      // Restore before awaiting the GPU fence: animation may render meanwhile.
      renderer.setRenderTarget(previousTarget,previousFace,previousMip);
      renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
      renderer.autoClear=previousAutoClear;
    }
    try {
      await pending;
      return samples.map((p,i)=>({...p,landDepth:data[i*4],waterDepth:data[i*4+1],waterAlpha:data[i*4+2]}));
    } finally { target.dispose();geometry.dispose();material.dispose(); }
  }

  resize(width:number,height:number):void {
    this.landTarget.setSize(width,height);this.waterTarget.setSize(width,height);this.colorTarget.setSize(width,height);
    const aoWidth=Math.ceil(width/2),aoHeight=Math.ceil(height/2);
    this.occlusionTarget.setSize(aoWidth,aoHeight);
    this.occlusion.uniforms.uFullResolution.value.set(width,height);
    this.merge.uniforms.uOcclusionPixel.value.set(1/aoWidth,1/aoHeight);
    this.fxaa.uniforms.resolution.value.set(1/width,1/height);
    if(this.grade){
      this.grade.hdr.setSize(width,height);
      this.grade.mips.forEach((mip,i)=>mip.setSize(Math.max(1,width>>(i+1)),Math.max(1,height>>(i+1))));
    }
  }
  setWaterOptics(camera:THREE.PerspectiveCamera,sun:THREE.DirectionalLight,direction:THREE.IUniform,color:THREE.IUniform):void{
    this.sunlight=sun;
    this.merge.uniforms.uCameraWorld.value=camera.matrixWorld;this.merge.uniforms.uInverseProjection.value=camera.projectionMatrixInverse;
    this.occlusion.uniforms.uInverseProjection.value=camera.projectionMatrixInverse;
    this.merge.uniforms.uCameraPosition.value=camera.position;this.merge.uniforms.uSunDirection=direction;this.merge.uniforms.uSunColor=color;
    this.shadowUniforms.uSunShadowMatrix.value=sun.shadow.matrix;
  }

  render(land:THREE.Scene,water:THREE.Scene,camera:THREE.PerspectiveCamera):void {
    this.merge.uniforms.uNearFar.value.set(camera.near,camera.far);
    this.renderer.setClearColor(0,1);
    this.renderer.setRenderTarget(this.landTarget);this.renderer.render(land,camera);
    if(this.sunlight?.shadow.map?.depthTexture){
      this.shadowUniforms.uSunShadow.value=this.sunlight.shadow.map.depthTexture;this.shadowUniforms.uShadowReady.value=1;
      this.shadowUniforms.uSunShadowTexel.value.set(1/this.sunlight.shadow.mapSize.x,1/this.sunlight.shadow.mapSize.y);
    }
    this.quad.material=this.occlusion;
    this.renderer.setRenderTarget(this.occlusionTarget);this.renderer.render(this.scene,this.camera);
    this.renderer.setClearColor(0,0);
    this.renderer.setRenderTarget(this.waterTarget);this.renderer.render(water,camera);
    this.quad.material=this.merge;
    if(this.grade)this.renderGrade();
    else{this.renderer.setRenderTarget(this.colorTarget);this.renderer.render(this.scene,this.camera);}
    this.quad.material=this.fxaa;
    this.renderer.setRenderTarget(null);this.renderer.render(this.scene,this.camera);
  }

  private renderGrade():void{
    const g=this.grade!,r=this.renderer;
    r.setRenderTarget(g.hdr);r.render(this.scene,this.camera);
    this.quad.material=g.down;
    let source=g.hdr;
    g.mips.forEach((mip,i)=>{
      g.down.uniforms.uSource.value=source.texture;g.down.uniforms.uTexel.value.set(.5/source.width,.5/source.height);g.down.uniforms.uKaris.value=i===0?1:0;
      r.setRenderTarget(mip);r.render(this.scene,this.camera);source=mip;
    });
    this.quad.material=g.up;
    const autoClear=r.autoClear;r.autoClear=false;
    for(let i=g.mips.length-1;i>0;i--){
      const from=g.mips[i];g.up.uniforms.uSource.value=from.texture;g.up.uniforms.uTexel.value.set(1/from.width,1/from.height);
      r.setRenderTarget(g.mips[i-1]);r.render(this.scene,this.camera);
    }
    r.autoClear=autoClear;
    this.quad.material=g.finish;g.finish.uniforms.uHdr.value=g.hdr.texture;g.finish.uniforms.uBloom.value=g.mips[0].texture;
    r.setRenderTarget(this.colorTarget);r.render(this.scene,this.camera);
  }

  dispose():void {
    if(this.grade){this.grade.hdr.dispose();this.grade.mips.forEach(m=>m.dispose());this.grade.down.dispose();this.grade.up.dispose();this.grade.finish.dispose();this.grade=null;}
    this.landTarget.dispose();this.waterTarget.dispose();this.colorTarget.dispose();this.occlusionTarget.dispose();
    this.geometry.dispose();this.merge.dispose();this.occlusion.dispose();this.fxaa.dispose();
  }
}
