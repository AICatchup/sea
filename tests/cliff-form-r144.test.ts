import test from 'node:test';
import assert from 'node:assert/strict';
import {structuralCoastHeight} from '../src/world/coast-structure.ts';
import {cliffOutcrops,cliffBodySegmentBlocked} from '../src/world/cliff-detail.ts';
import {IslandElevation,sandAt} from '../src/world/geodata.ts';

const bounds={minX:-210,maxX:-150,minZ:-150,maxZ:-90};
const slope={heightAt:(x:number)=>26+(x+180)*1.6};
test('R144 flag is opt-in and exact anchor negatives survive',()=>{
  for(const y of [-8,0,1.1,62,90])assert.equal(structuralCoastHeight(-180,-120,y,(x)=>y+(x+180)*2,0,false,false,true),y);
  for(const y of [2,4,20]){
    assert.equal(structuralCoastHeight(-180,-120,y,(x)=>y+(x+180)*.3,0,false,false,true),y);
    if(y<5)assert.equal(structuralCoastHeight(-180,-120,y,(x)=>y+(x+180)*2,1,false,false,true),y);
  }
  const base=new IslandElevation(),field=base.tomari!;
  let changed=0,positive=0,negative=0;
  for(let z=-160;z<70;z+=2.3)for(let x=-245;x<185;x+=2.7){
    const y=field.heightAt(x,z),sand=sandAt(x,z),sample=(a:number,b:number)=>field.heightAt(a,b);
    const result=structuralCoastHeight(x,z,y,sample,sand,false,false,true);
    assert.ok(Number.isFinite(result)&&result>=Math.min(y,1.1));
    assert.ok(Math.abs(result-y)<=6.000001);
    if(y<=1.1||y>=62||(y<5&&sand>=.3))assert.equal(result,y);
    if(result-y>.1)positive++;if(result-y<-.1)negative++;
    if(Math.abs(result-y)>.1)changed++;
    assert.equal(structuralCoastHeight(x,z,y,sample,sand,true,true),structuralCoastHeight(x,z,y,sample,sand,true,true,false));
  }
  assert.ok(changed>1000&&positive>100&&negative>100,`${changed}/${positive}/${negative}`);
  const old=cliffOutcrops(slope,bounds,true),explicit=cliffOutcrops(slope,bounds,true,false);
  assert.deepEqual(old.getAttribute('position').array,explicit.getAttribute('position').array);
});
test('connected shell has finite noncollapsed wound closed edges within budget',()=>{
  const mesh=cliffOutcrops(slope,bounds,false,true),p=mesh.getAttribute('position'),n=mesh.getAttribute('normal'),index=mesh.index!;
  assert.ok(mesh.userData.connectedCells>10&&index.count/3<=80000);
  assert.ok(p.count<index.count,'shared vertices connect adjacent facets');
  const edges=new Map<string,{count:number;direction:number}>();let volume=0;
  for(let i=0;i<p.count;i++)for(let k=0;k<3;k++){assert.ok(Number.isFinite(p.array[i*3+k]));assert.ok(Number.isFinite(n.array[i*3+k]));}
  for(let i=0;i<index.count;i+=3){
    const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)];
    const [a,b,c]=ids.map(id=>[p.getX(id),p.getY(id),p.getZ(id)]);
    const u=b.map((v,k)=>v-a[k]),v=c.map((w,k)=>w-a[k]);
    const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    assert.ok(Math.hypot(...cross)>.0001);
    volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    for(let k=0;k<3;k++){const x=ids[k],y=ids[(k+1)%3],key=x<y?`${x}:${y}`:`${y}:${x}`;
      const edge=edges.get(key)??{count:0,direction:0};edge.count++;edge.direction+=x<y?1:-1;edges.set(key,edge);}
  }
  for(const e of edges.values())assert.deepEqual(e,{count:2,direction:0});assert.ok(volume>0);
  const proxies=mesh.userData.collisionProxies;
  const proxy=proxies[Math.floor(proxies.length/2)],z=(proxy.minZ+proxy.maxZ)/2,y=(proxy.minY+proxy.maxY)/2;
  assert.equal(cliffBodySegmentBlocked([proxy],{x:proxy.minX-3,y,z},{x:proxy.maxX+3,y,z}),true);
  assert.equal(cliffBodySegmentBlocked(proxies,{x:-190,y:.2,z:-170},{x:-155,y:.2,z:-170}),false,'low offshore sweep stays open');
  assert.equal(cliffBodySegmentBlocked(proxies,{x:-190,y:65,z:-120},{x:-155,y:65,z:-120}),false,'high crown sweep stays open');
});
test('sea, strand, gentle and high crown emit no candidate collision volumes',()=>{
  for(const heightAt of [()=>-3,()=>1.1,()=>3,()=>65,(x:number)=>2+x*.03]){
    const mesh=cliffOutcrops({heightAt},bounds,false,true);assert.equal(mesh.userData.connectedCells,0);assert.equal(mesh.userData.collisionProxies.length,0);
  }
});

test('actual source shell retains dry strand and vessel-height negative sweeps',()=>{
  const ground=new IslandElevation(),mesh=cliffOutcrops(ground,ground.coast!,false,true);
  const proxies=mesh.userData.collisionProxies,p=mesh.getAttribute('position'),n=mesh.getAttribute('normal');
  assert.ok(proxies.length>100&&mesh.userData.triangleCount<=80000);
  for(let i=0;i<p.count*3;i++){assert.ok(Number.isFinite(p.array[i]));assert.ok(Number.isFinite(n.array[i]));}
  for(const proxy of proxies)assert.ok(proxy.minY>=2.099999);
  for(let z=27;z>-32;z-=2)assert.equal(cliffBodySegmentBlocked(proxies,{x:-36,y:1,z},{x:-36,y:1,z:z-2}),false);
  assert.equal(cliffBodySegmentBlocked(proxies,{x:-142,y:-.2,z:-97},{x:140,y:-.2,z:-150},1.4,1.7),false);
  assert.deepEqual(cliffOutcrops(ground,ground.coast!,false,true).index!.array,mesh.index!.array);
});
