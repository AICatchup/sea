import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { IslandElevation, sandAt } from '../src/world/geodata.ts';
import { cliffOutcrops } from '../src/world/cliff-detail.ts';
import { structuralCoastHeight } from '../src/world/coast-structure.ts';

const elevation=new IslandElevation();
const geometry=cliffOutcrops(elevation,elevation.coast!);
const vertices=geometry.getAttribute('position');
const point=(i:number)=>new THREE.Vector3().fromBufferAttribute(vertices,i);

test('authored cliff bodies are closed, nondegenerate and outward wound',()=>{
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
