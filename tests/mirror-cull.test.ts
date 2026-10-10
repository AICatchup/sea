import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {ReflectionCull,certifyEarthOnlyMaterial,includeEarthCurvature,beyondReflectionClip} from '../src/ocean/mirror-cull.ts';

function setup(above=true){
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(62,16/9,.12,35000);
  camera.position.set(0,above?10:-2,0);camera.lookAt(0,camera.position.y,-1);camera.updateMatrixWorld();
  const reflector=new Reflector(new THREE.PlaneGeometry(2,2),{clipBias:.001});
  reflector.rotation.x=above?-Math.PI/2:Math.PI/2;reflector.updateMatrixWorld(true);
  const cull=new ReflectionCull(),context=new THREE.Group();
  let observe:(camera:THREE.Camera)=>void=()=>{};
  const renderer={shadowMap:{autoUpdate:false,needsUpdate:false},xr:{enabled:false},autoClear:true,
    state:{buffers:{depth:{setMask(){}}},viewport(){}},getRenderTarget:()=>null,setRenderTarget(){},
    render(s:THREE.Scene,c:THREE.Camera){
      // The actual WebGLRenderer sequence: scene matrix refresh -> scene hook
      // -> shadow pass -> draw list. Reflector itself is the installed three code.
      s.updateMatrixWorld();
      (s.onBeforeRender as unknown as (...args:unknown[])=>void).call(s,renderer,s,c,reflector.getRenderTarget());
      observe(c);
    }} as unknown as THREE.WebGLRenderer;
  return{scene,camera,reflector,cull,renderer,run(fn:typeof observe){observe=fn;cull.render(reflector,renderer,scene,camera,context);},
    mesh(y:number,z=-20){const m=new THREE.Mesh(new THREE.BoxGeometry(.02,.02,.02),new THREE.MeshStandardMaterial());m.position.set(0,y,z);scene.add(m);return m;}};
}

test('installed Reflector clipBias retains far-side vertices that a fixed y margin wrongly removes',()=>{
  for(const above of [true,false]){
    const s=setup(above),near=s.mesh(above?-1:1),biased=s.mesh(above?-.06:.06,-1000),shown=s.mesh(above?1:-1);
    s.run(camera=>{
      assert.equal(near.visible,false);assert.equal(shown.visible,true);assert.equal(biased.visible,true);
      const clip=new THREE.Vector4(0,biased.position.y,-1000,1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
      assert.ok(clip.z+clip.w>0,'biased vertex really survives the installed reflection projection');
    });
    assert.equal(near.visible,true);assert.equal(s.cull.hiddenCount,1);
  }
});

test('pending shadow updates retain every caster, and hidden visibility and original hook survive exceptions',()=>{
  const s=setup(),mesh=s.mesh(-2),alreadyHidden=s.mesh(-3);alreadyHidden.visible=false;
  let hookCalls=0;const original=function(this:THREE.Scene){assert.equal(this,s.scene);hookCalls++;};s.scene.onBeforeRender=original;
  s.renderer.shadowMap.needsUpdate=true;
  s.run(()=>{assert.equal(mesh.visible,true);assert.equal(alreadyHidden.visible,false);});
  assert.equal(s.cull.hiddenCount,0);assert.equal(s.scene.onBeforeRender,original);
  s.renderer.shadowMap.needsUpdate=false;
  assert.throws(()=>s.run(()=>{assert.equal(mesh.visible,false);throw Error('draw failed');}),/draw failed/);
  assert.equal(mesh.visible,true);assert.equal(alreadyHidden.visible,false);assert.equal(s.scene.onBeforeRender,original);assert.equal(hookCalls,2);
  s.run(()=>assert.equal(mesh.visible,false));assert.equal(hookCalls,3);
});

test('world transforms and instance/geometry mutations are current before classification',()=>{
  const s=setup(),mesh=s.mesh(-2);s.scene.updateMatrixWorld();mesh.position.y=2;
  const geometry=new THREE.BoxGeometry(.02,.02,.02),instances=new THREE.InstancedMesh(geometry,new THREE.MeshStandardMaterial(),2);
  instances.setMatrixAt(0,new THREE.Matrix4().makeTranslation(0,-2,-20));instances.setMatrixAt(1,new THREE.Matrix4().makeTranslation(0,2,-20));
  instances.count=1;instances.instanceMatrix.needsUpdate=true;s.scene.add(instances);
  s.run(()=>{assert.equal(mesh.visible,true);assert.equal(instances.visible,false);});
  instances.count=2;s.run(()=>assert.equal(instances.visible,true));
  instances.count=1;instances.setMatrixAt(0,new THREE.Matrix4().makeTranslation(0,2,-20));instances.instanceMatrix.needsUpdate=true;
  s.run(()=>assert.equal(instances.visible,true));
  const pos=geometry.getAttribute('position');for(let i=0;i<pos.count;i++)pos.setY(i,pos.getY(i)-4);pos.needsUpdate=true;
  s.run(()=>assert.equal(instances.visible,false));
  instances.geometry=new THREE.BoxGeometry(.02,10,.02);s.run(()=>assert.equal(instances.visible,true));
});

test('curved world bounds conservatively include far land in underwater reflection',()=>{
  const s=setup(false),flat=s.mesh(4,-10000),curved=s.mesh(4,-10000);
  const material=curved.material as THREE.Material;material.onBeforeCompile=()=>{};certifyEarthOnlyMaterial(material);
  s.run(camera=>{
    assert.equal(flat.visible,false);assert.equal(curved.visible,true);
    const box=new THREE.Box3().setFromObject(curved),cameraPosition=new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    includeEarthCurvature(box,cameraPosition);assert.ok(box.min.y < -3.8);
  });
});

test('unproven vertex shaders, morphs, skins and mesh parents remain in the pass',()=>{
  const s=setup(),custom=s.mesh(-2),shader=s.mesh(-2),morph=s.mesh(-2),parent=s.mesh(-2),mutated=s.mesh(-2);
  (custom.material as THREE.Material).onBeforeCompile=()=>{};
  shader.material=new THREE.ShaderMaterial();
  morph.geometry.morphAttributes.position=[morph.geometry.getAttribute('position').clone()];
  const child=s.mesh(2);parent.add(child);
  const mat=mutated.material as THREE.Material;mat.onBeforeCompile=()=>{};certifyEarthOnlyMaterial(mat);mat.onBeforeCompile=()=>{};
  const skin=new THREE.SkinnedMesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());skin.position.y=-2;s.scene.add(skin);
  s.run(()=>{for(const mesh of [custom,shader,morph,parent,mutated,skin])assert.equal(mesh.visible,true);});
  s.cull.enabled=false;const plain=s.mesh(-2);s.run(()=>assert.equal(plain.visible,true));
});

test('clip predicate retains uncertainty and exact boundary contact',()=>{
  const box=new THREE.Box3(new THREE.Vector3(-1,-2,-1),new THREE.Vector3(1,-.05,1)),plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  assert.equal(beyondReflectionClip(box,plane),false);box.max.y=-.051;assert.equal(beyondReflectionClip(box,plane),true);
  box.max.y=NaN;assert.equal(beyondReflectionClip(box,plane),false);
});
