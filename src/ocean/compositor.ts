import * as THREE from 'three';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

/** Metres along a normalized view ray; depth is camera-axis distance. */
export function underwaterRayDistance(axisDistance: number, forwardCosine: number): number {
  return Math.max(0, axisDistance) / Math.max(1e-6, Math.abs(forwardCosine));
}

/** Beer-Lambert transmission is never clipped to an artistic visibility radius. */
export function underwaterTransmission(path: number, extinction: number): number {
  return Math.exp(-Math.max(0, extinction) * Math.max(0, path));
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
 varying vec2 vUv;
 uniform sampler2D uLand, uWater, uLandDepth, uWaterDepth, uOcclusion;
 uniform float uExposure, uUnderwater, uTime;
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
     // Sample the illuminated near volume while retaining the full extinction
     // distance. Beyond 500m even the least absorbing channel is negligible.
     vec3 volume=vec3(0.0);float stepLength=min(path,500.0)/8.0;
     float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(73.156,52.235)))*43758.5453);
     for(int i=0;i<8;i++){
       float distance=(float(i)+.25+jitter*.5)*stepLength;
       vec3 point=uCameraPosition+ray*distance;
       float waterDepth=max(0.0,-point.y);
       vec3 lightTrans=exp(-extinction*waterDepth/max(.35,refractedSun.y));
       // Integrate camera transmittance over each cell analytically. A midpoint
       // times width would miss the near volume on long rays and darken it.
       vec3 cameraIntegral=(exp(-extinction*float(i)*stepLength)
         -exp(-extinction*float(i+1)*stepLength))/extinction;
       float visibility=solarVisibility(point);
       volume+=cameraIntegral*lightTrans*vec3(.0008,.0028,.0041)*uSunColor*(.12+phase*.12)*visibility;
     }
     vec3 scatter=vec3(.003,.026,.041);
     vec3 underwater=color*transmission+scatter*(1.0-transmission)+volume;
     color=mix(color,underwater,uUnderwater);
   }
   color*=uExposure;
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
  }

  resize(width:number,height:number):void {
    this.landTarget.setSize(width,height);this.waterTarget.setSize(width,height);this.colorTarget.setSize(width,height);
    const aoWidth=Math.ceil(width/2),aoHeight=Math.ceil(height/2);
    this.occlusionTarget.setSize(aoWidth,aoHeight);
    this.occlusion.uniforms.uFullResolution.value.set(width,height);
    this.merge.uniforms.uOcclusionPixel.value.set(1/aoWidth,1/aoHeight);
    this.fxaa.uniforms.resolution.value.set(1/width,1/height);
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
    this.renderer.setRenderTarget(this.colorTarget);this.renderer.render(this.scene,this.camera);
    this.quad.material=this.fxaa;
    this.renderer.setRenderTarget(null);this.renderer.render(this.scene,this.camera);
  }

  dispose():void {
    this.landTarget.dispose();this.waterTarget.dispose();this.colorTarget.dispose();this.occlusionTarget.dispose();
    this.geometry.dispose();this.merge.dispose();this.occlusion.dispose();this.fxaa.dispose();
  }
}
