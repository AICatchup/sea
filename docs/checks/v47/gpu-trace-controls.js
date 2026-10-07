(() => {
  const job=window.__traceNegative47={status:'running'};
  (async()=>{
    const url=performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('/src/ocean/renderer.ts')).at(-1);
    const {Ocean}=await import(url),previous=Ocean.prototype.probeFoliage;
    try{Ocean.prototype.probeFoliage=function(...args){window.__controlOcean47=this;return previous.apply(this,args);};__seaQA.objectAt(0,0);}
    finally{Ocean.prototype.probeFoliage=previous;}
    const o=__controlOcean47,T=await import(performance.getEntriesByType('resource').find(e=>e.name.includes('/three.js')).name);
    const water=o.waterScene.children.find(e=>e.isMesh).material.fragmentShader;
    const source=water.slice(water.indexOf('bool underwaterReflectionReceiver'),water.indexOf('float surfaceSunVisibility'));
    if(!source.includes('distance=0.0'))throw Error('Final trace source not loaded');
    const camera=new T.PerspectiveCamera(62,1,.1,100);camera.updateMatrixWorld();
    const bias=new T.Matrix4().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1);
    const matrix=bias.multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
    const depth=z=>new T.Vector3(0,0,-z).project(camera).z*.5+.5;
    const textures=[];
    function tex(left,right=left){const a=new Float32Array(16*16);for(let y=0;y<16;y++)for(let x=0;x<16;x++)a[y*16+x]=x<8?left:right;const t=new T.DataTexture(a,16,16,T.RedFormat,T.FloatType);t.minFilter=t.magFilter=T.NearestFilter;t.needsUpdate=true;textures.push(t);return t;}
    const plane=tex(depth(5)),empty=tex(1),near=tex(depth(.5)),edge=tex(depth(5),1);
    const cases=[
      {name:'known plane',tex:plane,origin:[0,0,-1],ray:[0,0,-1],expectedHit:true,distance:4},
      {name:'empty depth',tex:empty,origin:[0,0,-1],ray:[0,0,-1],expectedHit:false},
      {name:'UV outside',tex:plane,origin:[1000,0,-1],ray:[0,0,-1],expectedHit:false},
      {name:'receiver before ray origin',tex:near,origin:[0,0,-1],ray:[0,0,-1],expectedHit:false},
      {name:'passes plane silhouette into empty depth',tex:edge,origin:[-.5,0,-1],ray:[.5,0,-1],expectedHit:false},
      {name:'behind mirror camera',tex:plane,origin:[0,0,1],ray:[0,0,1],expectedHit:false},
      {name:'parallel to plane',tex:plane,origin:[0,0,-1],ray:[1,0,0],expectedHit:false},
    ];
    const target=new T.WebGLRenderTarget(1,1,{type:T.FloatType,depthBuffer:false}),g=new T.PlaneGeometry(2,2);
    const m=new T.ShaderMaterial({vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:'precision highp float;uniform sampler2D uReflectionDepth;uniform mat4 uReflectionMatrix,uReflectionInverseProjection,uReflectionCameraWorld;uniform vec3 origin,ray;'+source+'void main(){float d;vec2 uv;bool hit=traceUnderwaterReflection(origin,ray,d,uv);gl_FragColor=vec4(hit?1.:0.,d,uv);}',
      uniforms:{uReflectionDepth:{value:plane},uReflectionMatrix:{value:matrix},uReflectionInverseProjection:{value:camera.projectionMatrixInverse},uReflectionCameraWorld:{value:camera.matrixWorld},origin:{value:new T.Vector3()},ray:{value:new T.Vector3()}},depthTest:false,depthWrite:false,toneMapped:false});
    const scene=new T.Scene();scene.add(new T.Mesh(g,m));const r=o.renderer,oldTarget=r.getRenderTarget(),viewport=r.getViewport(new T.Vector4());
    try{
      job.cases=[];
      for(const c of cases){
        m.uniforms.uReflectionDepth.value=c.tex;m.uniforms.origin.value.set(...c.origin);m.uniforms.ray.value.set(...c.ray).normalize();
        r.setRenderTarget(target);r.render(scene,new T.Camera());const data=new Float32Array(4);r.readRenderTargetPixels(target,0,0,1,1,data);
        const hit=data[0]>.5,finite=Array.from(data).every(Number.isFinite);
        job.cases.push({name:c.name,expectedHit:c.expectedHit,expectedDistance:c.distance,hit,distance:data[1],uv:[data[2],data[3]],finite,pass:finite&&hit===c.expectedHit&&(!hit||Math.abs(data[1]-c.distance)<.001)});
      }
      job.pass=job.cases.every(c=>c.pass);job.status='done';
    }finally{r.setRenderTarget(oldTarget);r.setViewport(viewport);target.dispose();g.dispose();m.dispose();textures.forEach(t=>t.dispose());}
  })().catch(error=>{job.status='error';job.error=String(error);});
  return {started:true};
})()
