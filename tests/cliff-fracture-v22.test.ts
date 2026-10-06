import test from 'node:test';
import assert from 'node:assert/strict';
import {cliffOutcrops} from '../src/world/cliff-detail.ts';
import {IslandElevation} from '../src/world/geodata.ts';

test('V22 fractures have bounded supported geometry and normals in both tangent directions',()=>{
  const ground={heightAt:(x:number,z:number)=>26+(x+180)*1.6+(z+120)*.5};
  const mesh=cliffOutcrops(ground,{minX:-210,maxX:-150,minZ:-150,maxZ:-90},false,true);
  const p=mesh.getAttribute('position'),n=mesh.getAttribute('normal');
  let lo=Infinity,hi=-Infinity,nxLo=Infinity,nxHi=-Infinity,nzLo=Infinity,nzHi=-Infinity;
  for(let i=0;i<p.count;i+=2){
    const source=ground.heightAt(p.getX(i),p.getZ(i)),relief=p.getY(i)-source;
    assert.ok(relief>=-.04504&&relief<=.98004);
    assert.ok(Math.abs(p.getY(i+1)-(source-1.4))<.00004,'paired back remains embedded');
    lo=Math.min(lo,relief);hi=Math.max(hi,relief);
    nxLo=Math.min(nxLo,n.getX(i));nxHi=Math.max(nxHi,n.getX(i));
    nzLo=Math.min(nzLo,n.getZ(i));nzHi=Math.max(nzHi,n.getZ(i));
  }
  assert.ok(hi-lo>.2,'connected relief retains geometric shape');
  assert.ok(nxHi-nxLo>.15&&nzHi-nzLo>.15,'normals vary across both axes');
  assert.equal(mesh.userData.fractureFamilies,2);
});

test('V22 actual Tomari shell records measured bounds without claiming normal relief',()=>{
  const ground=new IslandElevation(true,true,true),mesh=cliffOutcrops(ground,ground.coast!,false,true);
  assert.ok(mesh.userData.triangleCount<=80000);
  assert.ok(mesh.userData.maxVerticalReliefM<=.98);
  assert.equal(mesh.userData.maxNormalProtrusionM,undefined);
  const edges=new Map<string,number>(),index=mesh.index!;
  for(let i=0;i<index.count;i+=3)for(const [a,b] of [[index.getX(i),index.getX(i+1)],[index.getX(i+1),index.getX(i+2)],[index.getX(i+2),index.getX(i)]]){const key=a<b?`${a}:${b}`:`${b}:${a}`;edges.set(key,(edges.get(key)??0)+1);}
  assert.ok([...edges.values()].every(count=>count===2),'every shell edge has exactly two incident triangles, including diagonal-only patches');
  assert.ok(mesh.userData.splitCorners>0,'actual corner-touch patches exercise the regression');
  const fronts=new Map<string,[number,number,number]>();
  for(let i=0;i<index.count;i+=3){const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)];if(ids.some(id=>id%2!==0))continue;
    for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3],key=a<b?`${a}:${b}`:`${b}:${a}`;const edge=fronts.get(key);fronts.set(key,[a,b,(edge?.[2]??0)+1]);}}
  const positions=mesh.getAttribute('position');let boundaryCount=0;
  for(const [a,b,count] of fronts.values())if(count===1){boundaryCount++;for(const id of [a,b]){
    const y=ground.heightAt(positions.getX(id),positions.getZ(id));
    assert.ok(positions.getY(id)<y-.035,'boundary face is buried, never an exposed triangular closing wall');}}
  assert.ok(boundaryCount>100);
  console.log(JSON.stringify({v22Cliff:{vertices:mesh.getAttribute('position').count,...Object.fromEntries(
    ['triangleCount','connectedCells','boundaryEdges','minVerticalReliefM','maxVerticalReliefM','minExposedVertexHeightM'].map(k=>[k,mesh.userData[k]]))}}));
});

