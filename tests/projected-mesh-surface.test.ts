import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createProjectedMeshSurface} from '../src/world/projected-mesh-surface.ts';
type Point={x:number;y:number;z:number};
const point=(x:number,z:number,y=0):Point=>({x,y,z});
function mesh(tris:Point[][]) {
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float64Array(tris.flatMap(t=>t.flatMap(p=>[p.x,p.y,p.z]))),3));g.setIndex(tris.flatMap((_,i)=>[3*i,3*i+1,3*i+2]));return g;
}
const rectangle=(x0:number,z0:number,x1:number,z1:number,y=0):Point[][]=>[
  [point(x0,z0,y),point(x1,z0,y),point(x1,z1,y)],
  [point(x0,z0,y),point(x1,z1,y),point(x0,z1,y)],
];
test('highest projected floor matches independent downward raycasting across overhang layers and both windings',()=>{
  const tris=[...rectangle(-2,-2,2,2,-3),...rectangle(-1,-1,1,1,4),[point(-2,-2,1),point(2,-2,5),point(0,2,3)]];
  for(const reverse of [false,true]) {
    const g=mesh(tris.map(t=>reverse?[...t].reverse():t)),origin=new THREE.Vector3(13,8,-7),s=createProjectedMeshSurface(g,origin,{cellSize:.25});
    const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));m.position.copy(origin);m.updateMatrixWorld();
    const ray=new THREE.Raycaster();
    for(let ix=0;ix<31;ix++)for(let iz=0;iz<31;iz++) {
      const x=10.7+ix*.153,z=-9.3+iz*.153;ray.set(new THREE.Vector3(x,100,z),new THREE.Vector3(0,-1,0));
      const hits=ray.intersectObject(m),actual=s.surfaceHeightAt(x,z);
      if(!hits.length)assert.equal(actual,null);else {assert.notEqual(actual,null);assert.ok(Math.abs(actual!-hits[0].point.y)<1e-9);}
    }
    assert.equal(s.surfaceHeightAt(13,-7),12);
    assert.equal(s.coversOriginalTriangle([point(13,-7,12),point(13.25,-7,12),point(13,-6.75,12)]),true);
    m.material.dispose();g.dispose();
  }
});
test('union coverage includes adjacent mesh faces and quarter metre triangles at grid boundaries',()=>{
  const s=createProjectedMeshSurface(mesh(rectangle(-1,-1,1,1)),undefined,{cellSize:.25});
  for(const start of [-.75,-.5,0,.25,.75]) {
    const t:[Point,Point,Point]=[point(start,start),point(start+.25,start),point(start,start+.25)];
    assert.equal(s.coversOriginalTriangle(t),true);assert.equal(s.coversOriginalTriangle([...t].reverse() as [Point,Point,Point]),true);
  }
  assert.equal(s.surfaceHeightAt(1,1),0);assert.equal(s.coversOriginalTriangle([point(.9,.9),point(1.1,.9),point(.9,1.1)]),false);
});
test('covered corners do not prove coverage across a hole or a diagonal slit',()=>{
  const target:[Point,Point,Point]=[point(0,0),point(1,0),point(0,1)];
  const hole=createProjectedMeshSurface(mesh([...rectangle(-.1,-.1,1.1,.3),...rectangle(-.1,.3,.3,1.1),...rectangle(.7,.3,1.1,1.1),...rectangle(.3,.7,.7,1.1)]));
  assert.ok(target.every(p=>hole.surfaceHeightAt(p.x,p.z)!==null));assert.equal(hole.coversOriginalTriangle(target),false);
  const slit=createProjectedMeshSurface(mesh([
    [point(-1,-1),point(2,-1),point(2,2.39)], [point(-1,-1),point(2,2.39),point(-1,-.61)],
    [point(-1,-.59),point(2,2.41),point(-1,3)], [point(-1,3),point(2,2.41),point(2,3)],
  ]));
  assert.ok(target.every(p=>slit.surfaceHeightAt(p.x,p.z)!==null));assert.equal(slit.coversOriginalTriangle(target),false);
});
test('repeated overlapping faces cannot fill a missing union region',()=>{
  const patch=rectangle(-.1,-.1,.4,1.1),s=createProjectedMeshSurface(mesh(Array.from({length:20},()=>patch).flat()));
  assert.equal(s.coversOriginalTriangle([point(0,0),point(1,0),point(0,1)]),false);
});
test('snapshot and dispose preserve borrowed geometry while invalid inputs fail conservatively',()=>{
  const g=mesh(rectangle(0,0,1,1,2));let disposed=0;g.addEventListener('dispose',()=>disposed++);
  const s=createProjectedMeshSurface(g);g.getAttribute('position').setY(0,100);g.setIndex([0,0,0]);
  assert.equal(s.surfaceHeightAt(.2,.1),2);s.dispose();s.dispose();assert.equal(disposed,0);assert.equal(s.surfaceHeightAt(.2,.1),null);
  assert.equal(s.coversOriginalTriangle([point(0,0),point(1,0),point(0,1)]),false);
  for(const bad of [mesh([[point(0,0),point(NaN,1),point(1,0)]]),mesh([[point(0,0),point(Infinity,1),point(1,0)]])]) {
    const invalid=createProjectedMeshSurface(bad);assert.equal(invalid.surfaceHeightAt(0,0),null);assert.equal(invalid.coversOriginalTriangle([point(0,0),point(1,0),point(0,1)]),false);assert.ok(invalid.diagnostics.invalidTriangles);
  }
  const badIndex=mesh(rectangle(0,0,1,1));badIndex.setIndex([0,1,99]);assert.equal(createProjectedMeshSurface(badIndex).surfaceHeightAt(.2,.2),null);
  const incomplete=mesh(rectangle(0,0,1,1));incomplete.setIndex([0,1,2,3]);assert.equal(createProjectedMeshSurface(incomplete).surfaceHeightAt(.2,.2),null);
  assert.equal(createProjectedMeshSurface(mesh(rectangle(0,0,1,1)).toNonIndexed()).surfaceHeightAt(.2,.2),null);
  const d=createProjectedMeshSurface(mesh([[point(0,0),point(0,1),point(0,2)]]));assert.equal(d.diagnostics.degenerateTriangles,1);assert.equal(d.surfaceHeightAt(0,1),null);
});
test('explicit resource budgets conservatively reject build and coverage work',()=>{
  const g=mesh(rectangle(0,0,10,10));const bounded=createProjectedMeshSurface(g,undefined,{maxGridEntries:2});assert.equal(bounded.surfaceHeightAt(0,0),null);assert.equal(bounded.diagnostics.buildLimitExceeded,true);
  const s=createProjectedMeshSurface(g,undefined,{maxCoverageOperations:1});assert.equal(s.coversOriginalTriangle([point(0,0),point(1,0),point(0,1)]),false);assert.equal(s.diagnostics.coverageLimitFailures,1);
  const cells=createProjectedMeshSurface(g,undefined,{maxQueryCells:1});assert.equal(cells.coversOriginalTriangle([point(0,0),point(2,0),point(0,2)]),false);
});

test('explicit square metre budget keeps small representable holes above the budget and reports approximation below it',()=>{
  const tolerance=1e-12,origin=new THREE.Vector3(73,0,-1010);
  const target:[Point,Point,Point]=[point(73,-1010),point(73.25,-1010),point(73,-1009.75)];
  for(const side of [1e-3,1e-5,1e-7]) {
    const a=.06,b=a+side;
    const g=mesh([...rectangle(0,0,.25,a),...rectangle(0,a,a,.25),...rectangle(b,a,.25,.25),...rectangle(a,b,b,.25)]);
    const exact=createProjectedMeshSurface(g,origin),approx=createProjectedMeshSurface(g,origin,{numericalAreaTolerance:tolerance});
    assert.ok(target.every(p=>approx.surfaceHeightAt(p.x,p.z)!==null));
    assert.equal(exact.coversOriginalTriangle(target),false);
    assert.equal(approx.coversOriginalTriangle(target),side===1e-7);
    assert.ok(Math.abs(approx.diagnostics.lastCoverageResidualArea-side*side)<side*side*.001);
    assert.equal(approx.diagnostics.approximateCoverageAcceptances,side===1e-7?1:0);
  }
});

test('a thin diagonal slit with covered corners exceeds the total-area budget even at native world offsets',()=>{
  const delta=1e-10,k=.1,origin=new THREE.Vector3(73,0,-1010);
  const g=mesh([
    [point(-1,-1),point(1,-1),point(1,1+k-delta)], [point(-1,-1),point(1,1+k-delta),point(-1,-1+k-delta)],
    [point(-1,-1+k+delta),point(1,1+k+delta),point(-1,2)], [point(-1,2),point(1,1+k+delta),point(1,2)],
  ]);
  const s=createProjectedMeshSurface(g,origin,{numericalAreaTolerance:1e-12});
  const t:[Point,Point,Point]=[point(73,-1010),point(73.25,-1010),point(73,-1009.75)];
  assert.ok(t.every(p=>s.surfaceHeightAt(p.x,p.z)!==null));assert.equal(s.coversOriginalTriangle(t),false);
  assert.ok(s.diagnostics.lastCoverageResidualArea>1e-12);assert.equal(s.diagnostics.approximateCoverageAcceptances,0);
});

test('nearest radius bridges only a requested micrometre edge gap and leaves strict queries unchanged',()=>{
  const s=createProjectedMeshSurface(mesh(rectangle(0,0,1,1,3)),undefined,{numericalAreaTolerance:1});
  assert.equal(s.surfaceHeightAt(-5e-6,.5),null);
  assert.deepEqual(s.nearestSurfacePoint(-5e-6,.5,1e-5),{x:0,z:.5,height:3,distanceM:5e-6});
  assert.equal(s.nearestSurfacePoint(-1e-4,.5,1e-5),null);
  assert.equal(s.nearestSurfacePoint(-5e-6,.5,4.999e-6),null);
  assert.equal(s.nearestSurfacePoint(-5e-6,.5,0),null);
  assert.deepEqual(s.nearestSurfacePoint(.25,.25,0),{x:.25,z:.25,height:3,distanceM:0});
  assert.equal(s.diagnostics.maxAcceptedDistanceM,5e-6);
  const slit=createProjectedMeshSurface(mesh([...rectangle(-1,0,-5e-5,1,3),...rectangle(5e-5,0,1,1,3)]),undefined,{numericalAreaTolerance:1});
  assert.equal(slit.surfaceHeightAt(0,.5),null);assert.equal(slit.nearestSurfacePoint(0,.5,1e-5),null);
});

test('thin steep triangles return convex original heights without plane extrapolation',()=>{
  const s=createProjectedMeshSurface(mesh([[point(0,0,0),point(1e-7,0,1000),point(0,1,0)]]));
  const hit=s.nearestSurfacePoint(5e-6,.5,1e-5)!;
  assert.ok(hit);assert.ok(hit.x>=0&&hit.x<=1e-7);assert.ok(hit.height>=0&&hit.height<=1000);
  assert.ok(Math.abs(hit.height-500)<.01);assert.ok(hit.distanceM<=1e-5);
  assert.equal(s.surfaceHeightAt(5e-6,.5),null);
});

test('translated bucket boundary searches adjacent buckets and snapshots geometry and origin',()=>{
  const g=mesh(rectangle(-1,0,0,1,2)),origin=new THREE.Vector3(73,8,-1015),s=createProjectedMeshSurface(g,origin,{cellSize:.25});
  g.getAttribute('position').setY(0,99);origin.set(0,0,0);
  const hit=s.nearestSurfacePoint(73+5e-6,-1014.5,1e-5)!;
  assert.ok(hit);assert.equal(hit.x,73);assert.equal(hit.z,-1014.5);assert.equal(hit.height,10);assert.ok(hit.distanceM<=1e-5);
  assert.equal(s.surfaceHeightAt(73+5e-6,-1014.5),null);
  assert.equal(s.nearestSurfacePoint(73+5e-6,-1014.5,1e-6),null);
});

test('nearest chooses minimum distance before height and highest layer only for identical projected points',()=>{
  const s=createProjectedMeshSurface(mesh([...rectangle(0,0,1,1,2),...rectangle(0,0,1,1,8),...rectangle(-.01,0,-.005,1,100)]));
  assert.equal(s.nearestSurfacePoint(.25,.5,.1)!.height,8);
  assert.equal(s.nearestSurfacePoint(-1e-6,.5,.1)!.height,8);
  assert.equal(s.nearestSurfacePoint(-1e-6,.5,.1)!.x,0);
  // Equidistant distinct boundaries retain triangle traversal order, not height.
  const tied=createProjectedMeshSurface(mesh([...rectangle(-2,-1,-1,1,2),...rectangle(1,-1,2,1,100)]));
  assert.equal(tied.nearestSurfacePoint(0,0,1)!.height,2);
  assert.equal(tied.nearestSurfacePoint(0,0,1)!.x,-1);
});

test('nearest invalid radius, cell or operation exhaustion and disposed surfaces fail conservatively',()=>{
  const g=mesh(rectangle(0,0,1,1)),s=createProjectedMeshSurface(g);
  for(const r of [-1,NaN,Infinity,-Infinity])assert.equal(s.nearestSurfacePoint(.5,.5,r),null);
  assert.equal(s.nearestSurfacePoint(NaN,.5,1),null);assert.equal(s.nearestSurfacePoint(.5,Infinity,1),null);
  assert.equal(s.nearestSurfacePoint(.5,.5,1e300),null);assert.equal(s.diagnostics.nearestBudgetFailures,1);
  const cells=createProjectedMeshSurface(g,undefined,{maxQueryCells:1});assert.equal(cells.nearestSurfacePoint(.5,.5,1),null);assert.equal(cells.diagnostics.nearestBudgetFailures,1);
  const ops=createProjectedMeshSurface(g,undefined,{maxCoverageOperations:1});assert.equal(ops.nearestSurfacePoint(.5,.5,0),null);assert.equal(ops.diagnostics.nearestBudgetFailures,1);
  s.dispose();assert.equal(s.nearestSurfacePoint(.5,.5,1),null);
  assert.equal(s.diagnostics.nearestQueries,8);assert.equal(s.diagnostics.maxAcceptedDistanceM,0);
});

test('coverage exposes owned world residual polygons including holes accepted by the explicit area budget',()=>{
  const a=.06,b=.07,origin=new THREE.Vector3(73,0,-1010);
  const g=mesh([...rectangle(0,0,.25,a),...rectangle(0,a,a,.25),...rectangle(b,a,.25,.25),...rectangle(a,b,b,.25)]);
  const target:[Point,Point,Point]=[point(73,-1010),point(73.25,-1010),point(73,-1009.75)];
  for(const tolerance of [0,1e-3]) {
    const s=createProjectedMeshSurface(g,origin,{numericalAreaTolerance:tolerance});
    assert.equal(s.coversOriginalTriangle(target),tolerance>0);assert.equal(s.diagnostics.lastCoverageResidualAvailable,true);
    const polygons=s.lastCoverageResidualPolygons(),points=s.lastCoverageResidualPoints();
    assert.ok(polygons.length>0);assert.ok(points.length>0);
    // Tiny roundoff pieces are intentionally exposed too, not filtered away.
    assert.ok(points.every(p=>p.x>=73-1e-12&&p.x<=73.25+1e-12&&p.z>=-1010-1e-12&&p.z<=-1009.75+1e-12));
    assert.ok(points.some(p=>p.x>=73+a-1e-12&&p.x<=73+b+1e-12&&p.z>=-1010+a-1e-12&&p.z<=-1010+b+1e-12));
    assert.ok(points.some(p=>Math.abs(p.x-(73+a))<1e-12));assert.ok(points.some(p=>Math.abs(p.z-(-1010+b))<1e-12));
    (points[0] as {x:number}).x=999;(polygons[0][0] as {z:number}).z=999;
    assert.ok(s.lastCoverageResidualPoints().every(p=>p.x!==999&&p.z!==999));
    // A later query clears current evidence but previously returned snapshots survive.
    const saved=s.lastCoverageResidualPolygons();
    assert.equal(s.coversOriginalTriangle([point(73,-1010),point(73.25,-1010),point(73.25,-1010+a)]),true);
    assert.deepEqual(s.lastCoverageResidualPoints(),[]);assert.equal(s.diagnostics.lastCoverageResidualAvailable,true);assert.ok(saved.length>0);
    s.dispose();assert.deepEqual(s.lastCoverageResidualPolygons(),[]);assert.equal(s.diagnostics.lastCoverageResidualAvailable,false);assert.ok(saved.length>0);
  }
});

test('incomplete coverage query budgets and invalid input provide no fabricated residual proof',()=>{
  const g=mesh(rectangle(0,0,1,1)),s=createProjectedMeshSurface(g,undefined,{maxCoverageOperations:1});
  assert.equal(s.coversOriginalTriangle([point(0,0),point(.25,0),point(0,.25)]),false);
  assert.equal(s.diagnostics.coverageLimitFailures,1);assert.equal(s.diagnostics.lastCoverageResidualAvailable,false);assert.deepEqual(s.lastCoverageResidualPoints(),[]);
  const full=createProjectedMeshSurface(g);full.coversOriginalTriangle([point(0,0),point(2,0),point(0,2)]);assert.equal(full.diagnostics.lastCoverageResidualAvailable,true);
  assert.equal(full.coversOriginalTriangle([point(NaN,0),point(2,0),point(0,2)]),false);assert.equal(full.diagnostics.lastCoverageResidualAvailable,false);assert.deepEqual(full.lastCoverageResidualPolygons(),[]);
});
