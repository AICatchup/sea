import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { IslandElevation, sandAt } from '../src/world/geodata.ts';
import { cliffOutcrops } from '../src/world/cliff-detail.ts';
import { structuralCoastHeight } from '../src/world/coast-structure.ts';

const elevation=new IslandElevation();
const geometry=cliffOutcrops(elevation,elevation.coast!);
const coherent=cliffOutcrops(elevation,elevation.coast!,true);
const vertices=geometry.getAttribute('position');
const point=(i:number)=>new THREE.Vector3().fromBufferAttribute(vertices,i);

test('authored cliff bodies are closed, nondegenerate and outward wound',()=>{
  for(const geometry of [cliffOutcrops(elevation,elevation.coast!,false),coherent]){
  const vertices=geometry.getAttribute('position');
  const point=(i:number)=>new THREE.Vector3().fromBufferAttribute(vertices,i);
  assert.equal(vertices.count,geometry.userData.rockPieces*44*3);
  for(let start=0;start<vertices.count;start+=44*3){
    const edges=new Map<string,{count:number;direction:number}>();
    const centre=new THREE.Vector3();
    for(let i=start;i<start+44*3;i++)centre.add(point(i));
    centre.divideScalar(44*3);
    let volume=0;
    for(let i=start;i<start+44*3;i+=3){
      const a=point(i),b=point(i+1),c=point(i+2);
      const normal=b.clone().sub(a).cross(c.clone().sub(a));
      assert.ok(normal.length()>.00001,'collapsed rock face');
      assert.ok(normal.dot(a.clone().add(b).add(c).divideScalar(3).sub(centre))>0,'inward rock face');
      volume+=a.dot(b.clone().cross(c))/6;
      const key=(p:THREE.Vector3)=>`${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`;
      for(const [p,q] of [[a,b],[b,c],[c,a]]){
        const k1=key(p),k2=key(q),keyEdge=k1<k2?`${k1}|${k2}`:`${k2}|${k1}`;
        const edge=edges.get(keyEdge)??{count:0,direction:0};
        edge.count++;edge.direction+=k1<k2?1:-1;edges.set(keyEdge,edge);
      }
    }
    assert.ok(volume>0,'rock encloses negative volume');
    for(const edge of edges.values())assert.deepEqual(edge,{count:2,direction:0},'unclosed or doubled rock edge');
  }
  }
});

test('metre scale faces emerge from their actual support surface within a fixed geometry budget',()=>{
  assert.ok(geometry.userData.triangleCount<=80000);
  assert.ok(geometry.userData.exposedCentralFaceAreaM2>1000);
  assert.ok(geometry.userData.buriedCentralFaceAreaM2<geometry.userData.exposedCentralFaceAreaM2*.03);
  assert.ok(geometry.userData.maxNormalProtrusionM>.3 && geometry.userData.maxNormalProtrusionM<2.5,'fragments retain bounded relief instead of growing large ridge blocks');
  assert.ok(geometry.userData.minExposedVertexHeightM>=2.2);
  assert.equal(geometry.userData.collisionProxies.length,geometry.userData.rockPieces);
  assert.match(geometry.userData.provenance,/Authored/);
  assert.match(geometry.userData.provenance,/not surveyed/);
});

test('coherent candidate is opt-in, deterministic, thinner and collision bounds include every solid vertex',()=>{
  const explicitLegacy=cliffOutcrops(elevation,elevation.coast!,false);
  assert.deepEqual(explicitLegacy.getAttribute('position').array,vertices.array);
  assert.deepEqual(explicitLegacy.getAttribute('color').array,geometry.getAttribute('color').array);
  assert.deepEqual(explicitLegacy.userData,geometry.userData);
  const repeat=cliffOutcrops(elevation,elevation.coast!,true);
  assert.deepEqual(repeat.getAttribute('position').array,coherent.getAttribute('position').array);
  const data=coherent.userData;
  assert.ok(data.rockPieces>100 && data.triangleCount<=80000);
  assert.ok(data.maxNormalProtrusionM<.9 && data.maxNormalProtrusionM<geometry.userData.maxNormalProtrusionM*.5);
  assert.ok(data.maxFaceWidthM<6.01);
  assert.ok(data.minExposedVertexHeightM>=2.2);
  assert.equal(data.collisionProxies.length,data.rockPieces);
  const candidateVertices=coherent.getAttribute('position');
  for(let i=0;i<candidateVertices.count;i++){
    const p=data.collisionProxies[Math.floor(i/(44*3))];
    const x=candidateVertices.getX(i),y=candidateVertices.getY(i),z=candidateVertices.getZ(i);
    // Float32 uploaded geometry can differ by a few micrometres from proxy doubles.
    const epsilon=.00005;
    assert.ok(x>=p.minX-epsilon && x<=p.maxX+epsilon && y>=p.minY-epsilon && y<=p.maxY+epsilon && z>=p.minZ-epsilon && z<=p.maxZ+epsilon);
  }
  assert.match(data.provenance,/Authored qualitative/);
  assert.match(data.provenance,/not surveyed/);
});

test('coherent toe relief has signed bounded detail while dry/shore and gentle domain negatives stay exact',()=>{
  const field=elevation.tomari!,base=(x:number,z:number)=>field.heightAt(x,z);
  let positive=0,negative=0,toe=0;
  for(let z=-160;z<70;z+=1.3)for(let x=-245;x<185;x+=1.7){
    const y=base(x,z),sand=sandAt(x,z),result=structuralCoastHeight(x,z,y,base,sand,true),delta=result-y;
    assert.ok(Number.isFinite(result) && Math.abs(delta)<=1.900001);
    if(y<=1.1 || y>=62 || (sand>=.3 && y<=5))assert.equal(delta,0);
    if(delta>.1)positive++;
    if(delta<-.1)negative++;
    if(y>1.1 && y<3.5 && Math.abs(delta)>.03)toe++;
    assert.equal(structuralCoastHeight(x,z,y,base,sand),structuralCoastHeight(x,z,y,base,sand,false));
  }
  assert.ok(positive>100 && negative>100 && toe>5,`signed ${positive}/${negative}; dry toe ${toe}`);
  for(const y of [-20,0,.9,1.1,62,80])assert.equal(structuralCoastHeight(0,0,y,(x)=>y+x*2,0,true),y);
  for(const y of [1.5,2.5,4,8,20]){
    assert.equal(structuralCoastHeight(0,0,y,(x)=>y+x*.3,0,true),y,'gentle terrain anchor');
    if(y<5)assert.equal(structuralCoastHeight(0,0,y,(x)=>y+x*2,1,true),y,'low sandy strand anchor');
  }
  // A steep synthetic face supplies a clean negative independently of DEM coverage.
  for(let z=-30;z<30;z+=.7){
    const y=2.5,result=structuralCoastHeight(-150,z,y,(x)=>y+(x+150)*2,0,true);
    assert.ok(result>1.1 && result<3.5,'toe cannot become an underwater wall or tall obstruction');
  }
  for(const anchor of [1.1,62]){
    const refined=(y:number)=>structuralCoastHeight(-150,12,y,(x)=>y+(x+150)*2,0,true);
    assert.ok(Math.abs(refined(anchor+.0001)-refined(anchor-.0001))<.0003,'dry/crown fade has no height discontinuity');
  }
});

test('candidate adds no detached body walls on gentle sand, low strand or sea',()=>{
  const bounds={minX:-70,maxX:20,minZ:-40,maxZ:60};
  for(const heightAt of [()=>-2,()=>.5,()=>2.5,(x:number,z:number)=>2.5+x*.05+z*.05]){
    const empty=cliffOutcrops({heightAt},bounds,true);
    assert.equal(empty.userData.rockPieces,0);
    assert.equal(empty.userData.collisionProxies.length,0);
  }
});

test('the authored scarp refinement keeps low strand and source boundaries, with bounded signed relief',()=>{
  const field=elevation.tomari!,base=(x:number,z:number)=>field.heightAt(x,z);
  let changed=0,positive=0,negative=0,highSandyWall=0;
  for(let z=-160;z<70;z+=2.3)for(let x=-245;x<185;x+=2.7){
    const y=base(x,z),sand=sandAt(x,z),refined=structuralCoastHeight(x,z,y,base,sand),delta=refined-y;
    assert.ok(delta<=5.500001 && delta>=-7.500001);
    if(y<3.5 || y>62)assert.equal(delta,0);
    if(sand>.62&&y>10&&Math.abs(delta)>.1)highSandyWall++;
    if(delta>.5)positive++;
    if(delta<-.5)negative++;
    if(Math.abs(delta)>.5)changed++;
  }
  assert.ok(changed>1000 && positive>100 && negative>100);
  assert.ok(highSandyWall>50,'the horizontal beach mask no longer erases joints from high rock walls');
  const coast=elevation.coast!;
  for(const [x,z] of [[coast.minX,20],[coast.maxX,20],[-40,coast.minZ],[-40,coast.maxZ]]){
    const dx=x===coast.minX||x===coast.maxX?.0001:0;
    const dz=dx?0:.0001;
    assert.ok(Math.abs(elevation.heightAt(x+dx,z+dz)-elevation.heightAt(x-dx,z-dz))<.003);
  }
});
