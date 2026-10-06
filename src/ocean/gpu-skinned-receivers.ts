import * as THREE from 'three';
import { SkinnedReceivers } from './skinned-receivers.ts';
import type { SkinnedGPUExport } from './skinned-receivers.ts';
import { gpuSkinFragment,gpuPackFragment,gpuComposeFragment } from './gpu-skinned-receivers-glsl.ts';
import {gpuSkinBounds,validateGPUSkinPose,type GPUSkinBound} from './gpu-skinned-safety.ts';
const WIDTH=1024;
const vertexShader=`void main(){gl_Position=vec4(position.xy,0.,1.);}`;
/** Optional WebGL2 candidate. No normal-update readback. Final output consumes one existing water sampler. */
export class GPUSkinnedReceivers {
 readonly layout:SkinnedGPUExport;
 readonly diagnostics={available:false,reason:'not updated',updates:0,cpuSubmitMs:0,boundsEpsilon:'2 Float32 ULP relative + 0.00001m',readbackBytes:0};
 private oracle:SkinnedReceivers;private renderer:THREE.WebGLRenderer;
 private bounds:GPUSkinBound[];private checkedTargets=new WeakSet<THREE.WebGLRenderTarget>();private shaderFailure='';
 private compiledVersions=new WeakMap<THREE.ShaderMaterial,number>();
 private composition:{texels:number;offset:number;update:number}|null=null;
 private readonly onContextLost=()=>{this.diagnostics.available=false;this.diagnostics.reason='WebGL context lost';this.checkedTargets=new WeakSet();};
 private readonly onContextRestored=()=>{this.checkedTargets=new WeakSet();this.shaderFailure='';this.materials.forEach(m=>m.needsUpdate=true);};
 private scene=new THREE.Scene();private camera=new THREE.Camera();private quad:THREE.Mesh;
 private textures:THREE.DataTexture[]=[];private targets:THREE.WebGLRenderTarget[]=[];private materials:THREE.ShaderMaterial[]=[];
 private source:THREE.DataTexture;private topology:THREE.DataTexture;private nodes:THREE.DataTexture;private bone:THREE.DataTexture;private world:THREE.DataTexture;private normal:THREE.DataTexture;private visibility:THREE.DataTexture;
 private vertices:THREE.WebGLRenderTarget;private packed:THREE.WebGLRenderTarget[];private current:THREE.WebGLRenderTarget;private output?:THREE.WebGLRenderTarget;private prefix?:THREE.DataTexture;private disposed=false;private maxDepth=0;private initialMaterial=new THREE.MeshBasicMaterial();
 constructor(renderer:THREE.WebGLRenderer,oracle:SkinnedReceivers){this.renderer=renderer;this.oracle=oracle;this.layout=oracle.exportGPU();this.bounds=gpuSkinBounds(this.layout);const l=this.layout;this.maxDepth=l.nodes.reduce((d,n)=>Math.max(d,n.depth),0);
 const src=new Float32Array(l.vertices*20);for(let si=0;si<l.surfaces.length;si++){const s=l.surfaces[si];for(let vi=0;vi<s.source.length/14;vi++){const o=(s.vertexOffset+vi)*20,b=vi*14;src.set(s.source.subarray(b,b+3),o);src.set(s.source.subarray(b+3,b+6),o+4);for(let j=0;j<4;j++)src[o+8+j]=s.source[b+6+j]/16+s.boneOffset;src.set(s.source.subarray(b+10,b+14),o+12);src[o+16]=si;}}
 this.source=this.texture(src);const tri=new Float32Array(l.triangles.length*8);l.triangles.forEach((t,i)=>{tri.set([...t.vertices,t.surface,t.material],i*8);});this.topology=this.texture(tri);
 const nd=new Float32Array(l.nodes.length*8);l.nodes.forEach((n,i)=>nd.set([n.left,n.right,n.start,n.count,n.depth],i*8));this.nodes=this.texture(nd);
 this.bone=this.texture(new Float32Array(l.bones*16));this.world=this.texture(new Float32Array(l.surfaces.length*16));this.normal=this.texture(new Float32Array(l.surfaces.length*12));this.visibility=this.texture(new Float32Array(l.surfaces.length*oracle.materials.length*4));
 this.vertices=this.target(l.vertices*2);this.packed=[this.target(l.texels),this.target(l.texels)];this.current=this.packed[0];
 this.quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.initialMaterial);this.quad.frustumCulled=false;this.scene.add(this.quad);
 this.materials.push(this.material(gpuSkinFragment,{sourceData:this.source,bones:this.bone,worlds:this.world,normals:this.normal,vertices:l.vertices}),this.material(gpuPackFragment,{previous:this.texture(l.staticPacked),vertexData:this.vertices.texture,triangles:this.topology,nodeData:this.nodes,visibility:this.visibility,triangleOffset:l.triangleOffset,totalTexels:l.texels,depth:0,materials:oracle.materials.length}),this.material(gpuComposeFragment,{prefixData:null,skinData:null,prefixTexels:0,skinTexels:l.texels}));
 renderer.domElement.addEventListener('webglcontextlost',this.onContextLost);renderer.domElement.addEventListener('webglcontextrestored',this.onContextRestored);
 }
 private texture(values:Float32Array){const data=new Float32Array(WIDTH*Math.max(1,Math.ceil(values.length/4/WIDTH))*4);data.set(values);const t=new THREE.DataTexture(data,WIDTH,data.length/4/WIDTH,THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.NearestFilter;t.generateMipmaps=false;t.needsUpdate=true;this.textures.push(t);return t;}
 private target(texels:number){const t=new THREE.WebGLRenderTarget(WIDTH,Math.max(1,Math.ceil(texels/WIDTH)),{type:THREE.FloatType,format:THREE.RGBAFormat,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false,stencilBuffer:false});this.targets.push(t);return t;}
 private material(fragmentShader:string,values:Record<string,unknown>){const uniforms:Record<string,THREE.IUniform>={width:{value:WIDTH}};for(const [k,value]of Object.entries(values))uniforms[k]={value};return new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader,fragmentShader,uniforms,depthTest:false,depthWrite:false,toneMapped:false,blending:THREE.NoBlending});}
 private upload(t:THREE.DataTexture,data:Float32Array){(t.image.data as Float32Array).set(data);t.needsUpdate=true;}
 private draw(m:THREE.ShaderMaterial,t:THREE.WebGLRenderTarget,nodesOnly=false){
  // RenderTarget rectangles are physical texels. Renderer.setViewport/scissor
  // use logical pixels and would multiply them again when device DPR is >1.
  t.viewport.set(0,0,t.width,t.height);t.scissor.set(0,0,t.width,nodesOnly?Math.ceil(this.layout.triangleOffset/WIDTH):t.height);t.scissorTest=nodesOnly;
  this.quad.material=m;this.renderer.setRenderTarget(t);const gl=this.renderer.getContext();
  if(!this.checkedTargets.has(t)){if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Incomplete GPU skin framebuffer');this.checkedTargets.add(t);}
  if(this.compiledVersions.get(m)!==m.version){
   this.renderer.compile(this.scene,this.camera);
   const p=(this.renderer.properties.get(m) as {currentProgram?:{program:WebGLProgram;vertexShader:WebGLShader;fragmentShader:WebGLShader}}).currentProgram;
   if(!p?.program)throw new Error('GPU skin program unavailable');
   if(!gl.getProgramParameter(p.program,gl.LINK_STATUS)){
    this.shaderFailure=`GPU skin shader did not compile/link: ${gl.getProgramInfoLog(p.program)??''}`;
    const callback=this.renderer.debug.onShaderError;
    // Three 0.186 passes the native program; its type package names the wrapper.
    try{callback?.(gl,p.program as unknown as Parameters<NonNullable<typeof callback>>[1],p.vertexShader,p.fragmentShader);}
    finally{
     // No draw or uniform lookup is submitted for an unlinked program. Three's
     // first-use cleanup will not run, even if a caller's error observer throws.
     gl.deleteShader(p.vertexShader);gl.deleteShader(p.fragmentShader);
    }
    throw new Error(this.shaderFailure);
   }
   this.compiledVersions.set(m,m.version);
  }
  this.renderer.render(this.scene,this.camera);
  // Let Three finish registering the failed program so Material.dispose can free it.
  if(this.shaderFailure){gl.getError();throw new Error(this.shaderFailure);}
 }
 private guard<T>(fn:()=>T):T{
  const r=this.renderer,gl=r.getContext();if(gl.isContextLost())throw new Error('WebGL context lost');if(this.shaderFailure)throw new Error(this.shaderFailure);
  const target=r.getRenderTarget(),face=r.getActiveCubeFace(),level=r.getActiveMipmapLevel(),auto=r.autoClear,tone=r.toneMapping,color=r.outputColorSpace,clear=r.getClearColor(new THREE.Color()),alpha=r.getClearAlpha(),xr=r.xr.enabled,check=r.debug.checkShaderErrors,onShaderError=r.debug.onShaderError;
  const physical=target?{viewport:r.getCurrentViewport(new THREE.Vector4()),scissor:new THREE.Vector4().fromArray(gl.getParameter(gl.SCISSOR_BOX) as Int32Array),test:gl.isEnabled(gl.SCISSOR_TEST)}:null;
  try{
   r.xr.enabled=false;r.debug.checkShaderErrors=true;r.debug.onShaderError=(...args)=>{this.shaderFailure=`GPU skin shader did not compile/link: ${args[0].getProgramInfoLog(args[1])??''}`;onShaderError?.(...args);};
   r.autoClear=false;r.toneMapping=THREE.NoToneMapping;const result=fn();
   if(gl.isContextLost())throw new Error('WebGL context lost');const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error(`GPU skin WebGL error ${error}`);return result;
  }finally{
   r.debug.onShaderError=onShaderError;r.debug.checkShaderErrors=check;r.xr.enabled=xr;
   if(target&&physical){const viewport=target.viewport.clone(),scissor=target.scissor.clone(),test=target.scissorTest;try{target.viewport.copy(physical.viewport);target.scissor.copy(physical.scissor);target.scissorTest=physical.test;r.setRenderTarget(target,face,level);}finally{target.viewport.copy(viewport);target.scissor.copy(scissor);target.scissorTest=test;}}
   else r.setRenderTarget(target,face,level);
   r.autoClear=auto;r.toneMapping=tone;r.outputColorSpace=color;r.setClearColor(clear,alpha);
  }
 }
 update():boolean{const started=performance.now();this.diagnostics.available=false;if(this.disposed){this.diagnostics.reason='disposed';return false;}try{if(!this.renderer.extensions.has('EXT_color_buffer_float'))throw new Error('EXT_color_buffer_float required');const p=this.oracle.exportGPUPose();validateGPUSkinPose(this.bounds,p);this.upload(this.bone,p.bones);this.upload(this.world,p.worlds);this.upload(this.normal,p.normals);const vis=this.visibility.image.data as Float32Array;for(let i=0;i<p.visible.length;i++)vis[i*4]=p.visible[i];this.visibility.needsUpdate=true;
 this.guard(()=>{this.draw(this.materials[0],this.vertices);const m=this.materials[1];m.uniforms.previous.value=this.textures[7];m.uniforms.depth.value=0;this.draw(m,this.packed[0]);this.current=this.packed[0];for(let d=this.maxDepth;d>=1;d--){const next=this.current===this.packed[0]?this.packed[1]:this.packed[0];m.uniforms.previous.value=this.current.texture;m.uniforms.depth.value=d;
 // Both targets receive all current triangles once. Later levels update only
 // node rows; the unchanged triangle suffix stays valid in either target.
 this.draw(m,next,d!==this.maxDepth);this.current=next;}});this.diagnostics.available=true;this.diagnostics.reason='';this.diagnostics.updates++;this.diagnostics.cpuSubmitMs=performance.now()-started;return true;}catch(e){this.diagnostics.reason=String(e);this.diagnostics.cpuSubmitMs=performance.now()-started;return false;}}
 /** Prefix must contain whole RGBA texels; offset is texels. Returns null on invalid/stale pose. */
 compose(prefix:Float32Array):{texture:THREE.Texture;extraDataOffset:number;texels:number}|null{
  if(!this.diagnostics.available||this.disposed)return null;
  try{
   if(prefix.length%4)throw new Error('unaligned prefix');for(const v of prefix)if(!Number.isFinite(v))throw new Error('Non-finite receiver prefix');
   const texels=prefix.length/4,total=texels+this.layout.texels,height=Math.max(1,Math.ceil(total/WIDTH));
   if(WIDTH>this.renderer.capabilities.maxTextureSize||height>this.renderer.capabilities.maxTextureSize)throw new Error('GPU skin texture exceeds device limit');
   if(!this.prefix||(this.prefix.image.data as Float32Array).length<prefix.length){const old=this.prefix;this.prefix=this.texture(prefix);if(old){this.textures.splice(this.textures.indexOf(old),1);old.dispose();}}else this.upload(this.prefix,prefix);
   if(!this.output||this.output.height<height){const old=this.output;this.output=this.target(total);if(old){this.targets.splice(this.targets.indexOf(old),1);old.dispose();}}
   const m=this.materials[2];m.uniforms.prefixData.value=this.prefix;m.uniforms.skinData.value=this.current.texture;m.uniforms.prefixTexels.value=texels;this.guard(()=>this.draw(m,this.output!));this.composition={texels:total,offset:texels,update:this.diagnostics.updates};return{texture:this.output.texture,extraDataOffset:texels,texels:total};
  }catch(error){this.diagnostics.available=false;this.diagnostics.reason=String(error);return null;}
 }
 readback():Float32Array{if(!this.diagnostics.available)throw new Error(this.diagnostics.reason);const data=new Float32Array(this.current.width*this.current.height*4);this.guard(()=>this.renderer.readRenderTargetPixels(this.current,0,0,this.current.width,this.current.height,data));this.diagnostics.readbackBytes+=data.byteLength;return data.subarray(0,this.layout.texels*4);}
 /** Explicit diagnostic only. Normal rendering never copies GPU results to CPU. */
 readbackComposed(){if(!this.diagnostics.available||!this.output||this.composition?.update!==this.diagnostics.updates)throw new Error('Compose the current valid pose before readback');const data=new Float32Array(this.output.width*this.output.height*4);this.guard(()=>this.renderer.readRenderTargetPixels(this.output!,0,0,this.output!.width,this.output!.height,data));this.diagnostics.readbackBytes+=data.byteLength;return {data:data.subarray(0,this.composition.texels*4),extraDataOffset:this.composition.offset};}
 get resourceCounts(){return {textures:this.textures.length,targets:this.targets.length};}
 dispose(){if(this.disposed)return;this.disposed=true;this.diagnostics.available=false;this.diagnostics.reason='disposed';this.renderer.domElement.removeEventListener('webglcontextlost',this.onContextLost);this.renderer.domElement.removeEventListener('webglcontextrestored',this.onContextRestored);this.quad.geometry.dispose();this.initialMaterial.dispose();for(const m of this.materials)m.dispose();for(const t of this.targets)t.dispose();for(const t of this.textures)t.dispose();}
}


