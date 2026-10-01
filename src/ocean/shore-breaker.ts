import * as THREE from 'three';
import { shoreWaveSampling, shoreBreakerDissipationSampling } from './surface-detail.ts';

const SEGMENTS=96, SPAN=96;
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/** CPU mirror of the sheet gate, for boundedness and negative-path checks. */
export function breakerSheetEnvelope(depth:number,energy:number,crest:number,slope:number,curvature:number,shelter:number):number {
  if(![depth,energy,crest,slope,curvature,shelter].every(Number.isFinite)||depth<=.2||depth>=3.8||shelter<.18)return 0;
  return smooth(.2,.6,depth)*(1-smooth(2.8,3.8,depth))*smooth(.02,.25,energy)*smooth(.02,.2,crest)*smooth(.025,.22,slope)*smooth(.005,.12,-curvature)*Math.min(1,shelter);
}

/** Current-FFT supplemental crest shell. No clock, births, readback or textures.
 * It sharpens only incident shallow positive crests. This is a kinematic fold,
 * not a free-surface solver; see docs/shore-breaker-v8.md. */
export class ShoreBreaker {
  readonly group=new THREE.Group();
  readonly material:THREE.ShaderMaterial;
  readonly triangleCount=SEGMENTS*SEGMENTS*2;
  private readonly geometry=new THREE.PlaneGeometry(SPAN,SPAN,SEGMENTS,SEGMENTS);
  private disposed=false;
  constructor(){
    this.geometry.rotateX(-Math.PI/2);
    this.material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,
      uniforms:{uOrigin:{value:new THREE.Vector2()},uLongWaves:{value:null},uShortWaves:{value:null},uBathymetry:{value:null},uBathyTriangulated:{value:0},uBathyBounds:{value:new THREE.Vector4()},uBathyResolution:{value:new THREE.Vector2()},uSwell:{value:1},uWind:{value:8.5},uChoppiness:{value:1.55},uOccludingDepth:{value:null},uOccludingDepthReady:{value:0},uViewport:{value:new THREE.Vector2(1,1)}},
      vertexShader:`uniform vec2 uOrigin;uniform sampler2D uLongWaves,uShortWaves,uBathymetry;uniform vec4 uBathyBounds;uniform vec2 uBathyResolution;uniform float uSwell,uWind,uChoppiness;
      varying vec3 vWorld;varying float vEnvelope,vLip,vDepth;
      ${shoreWaveSampling}
      ${shoreBreakerDissipationSampling}
      vec2 coast(vec2 p){vec2 uv=(p-uBathyBounds.xy)/uBathyBounds.zw;if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec2(-110,1);return sampleCoastalGround(uBathymetry,uv,uBathyResolution).rg;}
      vec3 raw(vec2 p){return texture2D(uLongWaves,p/384.).xyz+texture2D(uShortWaves,p/24.).xyz;}
      vec3 displacement(vec2 p){return raw(p)*uSwell*shoreWaveScale(coast(p),uSwell,uWind);}
      vec2 inverseChop(vec2 world){vec2 p=world;for(int i=0;i<3;i++)p=world-displacement(p).xz*uChoppiness;return p;}
      float height(vec2 world){return displacement(inverseChop(world)).y;}
      void main(){vec2 world=position.xz+uOrigin,p=inverseChop(world);vec2 c=coast(world);float d=-c.x,h=height(world);
        // Terrain uphill normal supplies the local incident direction. No guessed time-period.
        vec2 uphill=vec2(coast(world+vec2(2,0)).x-coast(world-vec2(2,0)).x,coast(world+vec2(0,2)).x-coast(world-vec2(0,2)).x);
        float terrainGradient=length(uphill);vec2 n=uphill/max(terrainGradient,.00001);
        float behind=height(world-n*.75),ahead=height(world+n*.75);
        float slope=(h-ahead)/.75,curvature=(ahead+behind-2.*h)/(.75*.75);
        float energy=shoreBreakerDissipation(raw(p).y,c,uSwell,uWind);
        float gate=smoothstep(.2,.6,d)*(1.-smoothstep(2.8,3.8,d))*smoothstep(.02,.25,energy)*smoothstep(.02,.2,h)*smoothstep(.025,.22,slope)*smoothstep(.005,.12,-curvature)*clamp(c.y,0.,1.)*smoothstep(.0001,.01,terrainGradient);
        if(!(d>.2&&d<3.8&&c.y>=.18))gate=0.;
        // Bounded forward folding on the descending crest shoulder. FFT slope is phase.
        float phase=clamp(slope/.7,0.,1.);float radius=min(.65,d*.24)*gate;
        float angle=phase*2.7;
        world+=n*radius*(1.-cos(angle));float y=h+.018+radius*sin(angle);
        vec2 delta=world-cameraPosition.xz;y-=dot(delta,delta)/(2.*6371000.);
        vWorld=vec3(world.x,y,world.y);vEnvelope=gate;vLip=phase;vDepth=d;
        gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
      }`,
      fragmentShader:`uniform sampler2D uOccludingDepth;uniform float uOccludingDepthReady;uniform vec2 uViewport;varying vec3 vWorld;varying float vEnvelope,vLip,vDepth;
      void main(){if(vEnvelope<.006||vDepth<=.2||vDepth>=3.8)discard;
        if(uOccludingDepthReady>.5&&texture2D(uOccludingDepth,gl_FragCoord.xy/uViewport).r<gl_FragCoord.z-.0000002)discard;
        vec3 n=normalize(cross(dFdx(vWorld),dFdy(vWorld)));vec3 eye=normalize(cameraPosition-vWorld);
        float fresnel=pow(1.-abs(dot(n,eye)),5.);float foam=smoothstep(.65,.95,vLip)*vEnvelope;
        vec3 tint=mix(vec3(.12,.49,.51),vec3(.72,.83,.84),fresnel*.6+foam*.45);
        gl_FragColor=vec4(tint,vEnvelope*(.18+.45*fresnel+.16*foam));
      }`});
    const mesh=new THREE.Mesh(this.geometry,this.material);mesh.frustumCulled=false;this.group.add(mesh);
  }
  /** Bind shared IUniform objects: renderer updates then remain authoritative. */
  bindUniforms(uniforms:Record<string,THREE.IUniform>):void {
    for(const name of Object.keys(this.material.uniforms))if(name!=='uOrigin'&&uniforms[name])this.material.uniforms[name]=uniforms[name];
  }
  update(x:number,z:number,underwater:boolean):void {
    if(this.disposed)return;
    this.group.visible=!underwater&&Number.isFinite(x)&&Number.isFinite(z);
    if(this.group.visible)(this.material.uniforms.uOrigin.value as THREE.Vector2).set(x,z);
  }
  dispose():void {if(this.disposed)return;this.disposed=true;this.geometry.dispose();this.material.dispose();this.group.clear();}
}
