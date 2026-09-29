import * as THREE from 'three';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const vertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;
const mergeFragment = `
 precision highp float;
 varying vec2 vUv;
 uniform sampler2D uLand, uWater, uLandDepth, uWaterDepth;
 uniform float uExposure, uUnderwater, uTime;
 uniform vec2 uNearFar;
 float viewDistance(float d){float n=uNearFar.x,f=uNearFar.y;return 2.0*n*f/(f+n-(d*2.0-1.0)*(f-n));}
 void main(){
   vec4 water=texture2D(uWater,vUv);
   vec3 color=mix(texture2D(uLand,vUv).rgb,water.rgb,water.a);
   float depth=mix(texture2D(uLandDepth,vUv).r,texture2D(uWaterDepth,vUv).r,water.a);
   if(uUnderwater>0.0){
     float path=min(viewDistance(depth),110.0);
     vec3 transmission=exp(-vec3(0.125,0.042,0.028)*path);
     vec3 scatter=vec3(0.009,0.12,0.155);
     vec3 underwater=color*transmission+scatter*(1.0-transmission);
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
        uExposure:exposure,uUnderwater:underwater,uTime:time,uNearFar:{value:new THREE.Vector2(.12,35000)}} });
    this.quad = new THREE.Mesh(this.geometry, this.merge);
    this.quad.frustumCulled = false; this.scene.add(this.quad);
    this.fxaa.uniforms.tDiffuse.value = this.colorTarget.texture;
  }

  resize(width:number,height:number):void {
    this.landTarget.setSize(width,height);this.waterTarget.setSize(width,height);this.colorTarget.setSize(width,height);
    this.fxaa.uniforms.resolution.value.set(1/width,1/height);
  }

  render(land:THREE.Scene,water:THREE.Scene,camera:THREE.PerspectiveCamera):void {
    this.merge.uniforms.uNearFar.value.set(camera.near,camera.far);
    this.renderer.setClearColor(0,1);
    this.renderer.setRenderTarget(this.landTarget);this.renderer.render(land,camera);
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
