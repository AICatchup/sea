import * as THREE from 'three';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const vertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;
const mergeFragment = `
 precision highp float;
 varying vec2 vUv;
 uniform sampler2D uLand, uWater, uLandDepth, uWaterDepth;
 uniform float uExposure, uUnderwater, uTime;
 uniform vec2 uNearFar;
 uniform sampler2DShadow uSunShadow;
 uniform mat4 uSunShadowMatrix, uCameraWorld, uInverseProjection;
 uniform vec3 uSunDirection, uSunColor, uCameraPosition;
 uniform float uShadowReady;
 float solarVisibility(vec3 point){
   if(uShadowReady<.5)return 1.0;
   vec4 projected=uSunShadowMatrix*vec4(point,1.0);vec3 q=projected.xyz/projected.w;
   if(any(lessThan(q.xy,vec2(.001)))||any(greaterThan(q.xy,vec2(.999))))return 1.0;
   return texture(uSunShadow,vec3(q.xy,q.z-.0007));
 }
 float viewDistance(float d){float n=uNearFar.x,f=uNearFar.y;return 2.0*n*f/(f+n-(d*2.0-1.0)*(f-n));}
 void main(){
   vec4 water=texture2D(uWater,vUv);
   vec3 color=mix(texture2D(uLand,vUv).rgb,water.rgb,water.a);
   float depth=mix(texture2D(uLandDepth,vUv).r,texture2D(uWaterDepth,vUv).r,water.a);
   if(uUnderwater>0.0){
     vec4 viewPoint=uInverseProjection*vec4(vUv*2.0-1.0,1.0,1.0);
     vec3 viewRay=normalize(viewPoint.xyz/viewPoint.w);
     vec3 ray=normalize(mat3(uCameraWorld)*viewRay);
     float path=min(viewDistance(depth)/max(.2,-viewRay.z),85.0);
     if(ray.y>.001)path=min(path,max(.1,-uCameraPosition.y/ray.y));
     vec3 extinction=vec3(.145,.028,.018);
     vec3 transmission=exp(-extinction*path);
     vec3 refractedSun=-refract(-uSunDirection,vec3(0,1,0),.75019);
     float phase=(1.0-.72*.72)/pow(max(.03,1.0+.72*.72-2.0*.72*dot(ray,refractedSun)),1.5);
     vec3 volume=vec3(0.0);float stepLength=path/14.0;
     for(int i=0;i<14;i++){
       float distance=(float(i)+.5)*stepLength;
       vec3 point=uCameraPosition+ray*distance;
       float waterDepth=max(0.0,-point.y);
       vec3 lightTrans=exp(-extinction*waterDepth/max(.35,refractedSun.y));
       vec3 cameraTrans=exp(-extinction*distance);
       float visibility=solarVisibility(point);
       volume+=cameraTrans*lightTrans*vec3(.0015,.0055,.0080)*uSunColor*(.25+phase*.35)*visibility*stepLength;
     }
     vec3 scatter=vec3(.007,.065,.085);
     vec3 underwater=color*transmission+scatter*(1.0-transmission)+volume;
     color=mix(color,underwater,uUnderwater);
   }
   color*=uExposure;
   color=clamp((color*(2.51*color+0.03))/(color*(2.43*color+0.59)+0.14),0.0,1.0);
   color=pow(color,vec3(1.0/2.2));
   // Tiny ordered film-grain dither removes banding without a texture download.
   float grain=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-0.5;
   color+=grain/650.0;
   if(uUnderwater>0.0){
     vec2 p=vUv*2.0-1.0;
     float edge=smoothstep(0.52,1.2,length(p*vec2(0.80,1.0)));
     color*=1.0-edge*0.24*uUnderwater;
   }
   gl_FragColor=vec4(color,1.0);
 }`;

/** Separate opaque-scene and water buffers make depth-tested refraction possible. */
export class SceneCompositor {
  readonly landTarget: THREE.WebGLRenderTarget;
  readonly waterTarget: THREE.WebGLRenderTarget;
  private readonly colorTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly merge: THREE.ShaderMaterial;
  private readonly fxaa = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms),
    vertexShader: vertex,
    fragmentShader: FXAAShader.fragmentShader.replace('return texture( tex2D, uv );','return textureLod( tex2D, uv, 0.0 );'),
    depthTest: false, depthWrite: false, toneMapped: false });
  private readonly quad: THREE.Mesh;
  private sunlight:THREE.DirectionalLight|null=null;

  constructor(private readonly renderer: THREE.WebGLRenderer, exposure: THREE.IUniform, underwater: THREE.IUniform, time: THREE.IUniform) {
    const target = () => {
      const value = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true });
      value.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
      return value;
    };
    this.landTarget = target(); this.waterTarget = target();
    this.merge = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: mergeFragment,
      depthTest:false,depthWrite:false,toneMapped:false,
      uniforms:{uLand:{value:this.landTarget.texture},uWater:{value:this.waterTarget.texture},
        uLandDepth:{value:this.landTarget.depthTexture},uWaterDepth:{value:this.waterTarget.depthTexture},
        uExposure:exposure,uUnderwater:underwater,uTime:time,uNearFar:{value:new THREE.Vector2(.12,35000)},
        uSunShadow:{value:null},uSunShadowMatrix:{value:new THREE.Matrix4()},uCameraWorld:{value:new THREE.Matrix4()},
        uInverseProjection:{value:new THREE.Matrix4()},uCameraPosition:{value:new THREE.Vector3()},uSunDirection:{value:new THREE.Vector3(0,1,0)},
        uSunColor:{value:new THREE.Vector3(1,1,1)},uShadowReady:{value:0}} });
    this.quad = new THREE.Mesh(this.geometry, this.merge);
    this.quad.frustumCulled = false; this.scene.add(this.quad);
    this.fxaa.uniforms.tDiffuse.value = this.colorTarget.texture;
  }

  resize(width:number,height:number):void {
    this.landTarget.setSize(width,height);this.waterTarget.setSize(width,height);this.colorTarget.setSize(width,height);
    this.fxaa.uniforms.resolution.value.set(1/width,1/height);
  }
  setWaterOptics(camera:THREE.PerspectiveCamera,sun:THREE.DirectionalLight,direction:THREE.IUniform,color:THREE.IUniform):void{
    this.sunlight=sun;
    this.merge.uniforms.uCameraWorld.value=camera.matrixWorld;this.merge.uniforms.uInverseProjection.value=camera.projectionMatrixInverse;
    this.merge.uniforms.uCameraPosition.value=camera.position;this.merge.uniforms.uSunDirection=direction;this.merge.uniforms.uSunColor=color;
    this.merge.uniforms.uSunShadowMatrix.value=sun.shadow.matrix;
  }

  render(land:THREE.Scene,water:THREE.Scene,camera:THREE.PerspectiveCamera):void {
    this.merge.uniforms.uNearFar.value.set(camera.near,camera.far);
    this.renderer.setClearColor(0,1);
    this.renderer.setRenderTarget(this.landTarget);this.renderer.render(land,camera);
    if(this.sunlight?.shadow.map?.depthTexture){this.merge.uniforms.uSunShadow.value=this.sunlight.shadow.map.depthTexture;this.merge.uniforms.uShadowReady.value=1;}
    this.renderer.setClearColor(0,0);
    this.renderer.setRenderTarget(this.waterTarget);this.renderer.render(water,camera);
    this.quad.material=this.merge;
    this.renderer.setRenderTarget(this.colorTarget);this.renderer.render(this.scene,this.camera);
    this.quad.material=this.fxaa;
    this.renderer.setRenderTarget(null);this.renderer.render(this.scene,this.camera);
  }

  dispose():void {
    this.landTarget.dispose();this.waterTarget.dispose();this.colorTarget.dispose();
    this.geometry.dispose();this.merge.dispose();this.fxaa.dispose();
  }
}
