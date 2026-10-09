import type { BufferGeometry, Vector3 } from 'three';

export type SurfacePoint = Readonly<{x:number;y:number;z:number}>;
export type NearestSurfacePoint = Readonly<{x:number;z:number;height:number;distanceM:number}>;
export interface ProjectedMeshSurfaceOptions {
  /** Maximum TOTAL uncovered projected area in square metres. Default 0 is
   * strict. Positive values deliberately permit real gaps up to this area,
   * as well as clipping roundoff; callers must choose an acceptable budget.
   * This never dilates triangles or treats corner coverage as whole coverage.
   */
  numericalAreaTolerance?:number;
  cellSize?:number;
  maxTriangles?:number;
  maxGridEntries?:number;
  maxQueryCells?:number;
  maxCoverageOperations?:number;
  maxRemainingPolygons?:number;
}
type P = {x:number;z:number};
type Triangle = {p:SurfacePoint[];area:number;minX:number;maxX:number;minZ:number;maxZ:number};
const cross=(a:P,b:P,p:P)=>(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
const finite=(p:SurfacePoint)=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z);
const polygonArea=(p:P[])=>Math.abs(p.reduce((sum,a,i)=>sum+cross(p[0],a,p[(i+1)%p.length]),0))/2;
function clip(p:P[],a:P,b:P,inside:boolean):P[]|null {
  const out:P[]=[];
  for(let i=0;i<p.length;i++) {
    const s=p[i],e=p[(i+1)%p.length],ds=cross(a,b,s),de=cross(a,b,e);
    if(!Number.isFinite(ds)||!Number.isFinite(de)||!Number.isFinite(ds-de))return null;
    const si=inside?ds>=0:ds<=0,ei=inside?de>=0:de<=0;
    if(si)out.push(s);
    if(si!==ei) {const t=ds/(ds-de),q={x:s.x+(e.x-s.x)*t,z:s.z+(e.z-s.z)*t};if(!Number.isFinite(q.x)||!Number.isFinite(q.z))return null;out.push(q);}
  }
  return out;
}

/** Snapshot of indexed geometry in world coordinates. No borrowed resource is owned.
 * Coverage subtracts the union's triangles in coordinates local to the query.
 * Any positive residual area is a gap unless the caller explicitly supplies
 * numericalAreaTolerance. That option is an approximation, not exact proof.
 * Numeric rounding can cause conservative false negatives at coincident edges.
 */
export function createProjectedMeshSurface(geometry:BufferGeometry,origin?:Vector3,options:ProjectedMeshSurfaceOptions={}) {
  const limit=(value:number|undefined,fallback:number)=>Number.isFinite(value)&&value!>0?Math.floor(value!):fallback;
  const cellSize=Number.isFinite(options.cellSize)&&options.cellSize!>0?options.cellSize!:1;
  const maxTriangles=limit(options.maxTriangles,500_000),maxEntries=limit(options.maxGridEntries,4_000_000);
  const maxCells=limit(options.maxQueryCells,100_000),maxOperations=limit(options.maxCoverageOperations,200_000);
  const maxPieces=limit(options.maxRemainingPolygons,4096);
  const areaTolerance=Number.isFinite(options.numericalAreaTolerance)&&options.numericalAreaTolerance!>=0?options.numericalAreaTolerance!:0;
  const diagnostics={inputTriangles:0,indexedTriangles:0,degenerateTriangles:0,invalidTriangles:0,gridEntries:0,gridCells:0,buildLimitExceeded:false,coverageLimitFailures:0,coverageGapFailures:0,numericCoverageFailures:0,approximateCoverageAcceptances:0,numericalAreaTolerance:areaTolerance,lastCoverageResidualArea:0,lastCoverageResidualAvailable:false,nearestQueries:0,nearestBudgetFailures:0,numericNearestFailures:0,maxAcceptedDistanceM:0,invalidQueries:0,disposed:false};
  const triangles:Triangle[]=[],grid=new Map<string,number[]>();
  let residualPolygons:P[][]=[];
  const o={x:origin?.x??0,y:origin?.y??0,z:origin?.z??0};
  const position=geometry.getAttribute('position'),index=geometry.getIndex();
  let trustworthy=finite(o)&&!!position&&position.itemSize>=3&&!!index&&index.count%3===0;
  if(!trustworthy)diagnostics.invalidTriangles++;
  if(trustworthy&&position&&index) {
    diagnostics.inputTriangles=index.count/3;
    if(diagnostics.inputTriangles>maxTriangles) {trustworthy=false;diagnostics.buildLimitExceeded=true;}
    else for(let i=0;i<index.count;i+=3) {
      const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)];
      if(ids.some(id=>!Number.isInteger(id)||id<0||id>=position.count)) {diagnostics.invalidTriangles++;trustworthy=false;continue;}
      const p=ids.map(id=>({x:position.getX(id)+o.x,y:position.getY(id)+o.y,z:position.getZ(id)+o.z}));
      if(!p.every(finite)) {diagnostics.invalidTriangles++;trustworthy=false;continue;}
      let area=cross(p[0],p[1],p[2]);
      if(!Number.isFinite(area)) {diagnostics.invalidTriangles++;trustworthy=false;continue;}
      if(area===0) {diagnostics.degenerateTriangles++;continue;}
      if(area<0) {[p[1],p[2]]=[p[2],p[1]];area=-area;}
      const t={p,area,minX:Math.min(...p.map(v=>v.x)),maxX:Math.max(...p.map(v=>v.x)),minZ:Math.min(...p.map(v=>v.z)),maxZ:Math.max(...p.map(v=>v.z))};
      const x0=Math.floor(t.minX/cellSize),x1=Math.floor(t.maxX/cellSize),z0=Math.floor(t.minZ/cellSize),z1=Math.floor(t.maxZ/cellSize);
      const count=(x1-x0+1)*(z1-z0+1);
      if(![x0,x1,z0,z1].every(Number.isSafeInteger)||!Number.isSafeInteger(count)||count>maxEntries-diagnostics.gridEntries) {diagnostics.buildLimitExceeded=true;trustworthy=false;break;}
      const id=triangles.length;triangles.push(t);
      for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++) {const key=`${x},${z}`,bucket=grid.get(key);if(bucket)bucket.push(id);else grid.set(key,[id]);}
      diagnostics.gridEntries+=count;
    }
  }
  diagnostics.indexedTriangles=triangles.length;diagnostics.gridCells=grid.size;
  return {
    diagnostics,
    /** Owned copy of the last completed coverage query's remaining polygons in
     * world XZ, including queries accepted by the explicit area budget. Empty
     * output is proof of no residual ONLY when lastCoverageResidualAvailable
     * is true. Invalid, budget-limited and disposed queries have no evidence.
     */
    lastCoverageResidualPolygons():readonly (readonly Readonly<P>[])[] {
      return residualPolygons.map(polygon=>polygon.map(p=>({x:p.x,z:p.z})));
    },
    lastCoverageResidualPoints():readonly Readonly<P>[] {
      return residualPolygons.flatMap(polygon=>polygon.map(p=>({x:p.x,z:p.z})));
    },
    surfaceHeightAt(x:number,z:number):number|null {
      if(diagnostics.disposed||!trustworthy||!Number.isFinite(x)||!Number.isFinite(z))return null;
      let highest:number|null=null;
      for(const id of grid.get(`${Math.floor(x/cellSize)},${Math.floor(z/cellSize)}`)??[]) {
        const {p,area}=triangles[id],q={x,z};
        const a=cross(p[1],p[2],q)/area,b=cross(p[2],p[0],q)/area,c=cross(p[0],p[1],q)/area;
        if(a<0||b<0||c<0)continue;
        const height=a*p[0].y+b*p[1].y+c*p[2].y;
        if(Number.isFinite(height)&&(highest===null||height>highest))highest=height;
      }
      return highest;
    },
    /** Closest point in the projected triangle union within the explicit radius.
     * Distance has priority over height, with NO epsilon radius or distance tie.
     * Equal-distance candidates at exactly the same returned XZ choose the
     * highest layer; equal-distance distinct points retain traversal order.
     * Heights use convex weights on an actual triangle, never extrapolation.
     * This is independent of the coverage area's optional approximation budget.
     */
    nearestSurfacePoint(x:number,z:number,maxDistanceM:number):NearestSurfacePoint|null {
      diagnostics.nearestQueries++;
      if(diagnostics.disposed||!trustworthy)return null;
      if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(maxDistanceM)||maxDistanceM<0) {diagnostics.invalidQueries++;return null;}
      const x0=Math.floor((x-maxDistanceM)/cellSize),x1=Math.floor((x+maxDistanceM)/cellSize),z0=Math.floor((z-maxDistanceM)/cellSize),z1=Math.floor((z+maxDistanceM)/cellSize),cells=(x1-x0+1)*(z1-z0+1);
      const failBudget=()=>{diagnostics.nearestBudgetFailures++;return null;};
      const failNumeric=()=>{diagnostics.numericNearestFailures++;return null;};
      if(![x0,x1,z0,z1,cells].every(Number.isSafeInteger)||cells>maxCells)return failBudget();
      const candidates=new Set<number>();let operations=0;
      for(let bz=z0;bz<=z1;bz++)for(let bx=x0;bx<=x1;bx++)for(const id of grid.get(`${bx},${bz}`)??[]) {if(++operations>maxOperations)return failBudget();candidates.add(id);}
      let best:NearestSurfacePoint|null=null;
      const accept=(qx:number,qz:number,height:number):boolean=> {
        const distanceM=Math.hypot(qx-x,qz-z);
        if(![qx,qz,height,distanceM].every(Number.isFinite))return false;
        if(distanceM<=maxDistanceM&&(!best||distanceM<best.distanceM||(distanceM===best.distanceM&&qx===best.x&&qz===best.z&&height>best.height)))best={x:qx,z:qz,height,distanceM};
        return true;
      };
      for(const id of candidates) {
        if((operations+=3)>maxOperations)return failBudget();
        const {p,area}=triangles[id],q={x,z};
        const weights=[cross(p[1],p[2],q)/area,cross(p[2],p[0],q)/area,cross(p[0],p[1],q)/area];
        if(!weights.every(Number.isFinite))return failNumeric();
        if(weights.every(w=>w>=0)) {
          const clamped=weights.map(w=>Math.max(0,Math.min(1,w))),sum=clamped[0]+clamped[1]+clamped[2];
          const height=clamped.reduce((h,w,i)=>h+(w/sum)*p[i].y,0);
          if(!accept(x,z,Math.max(Math.min(...p.map(v=>v.y)),Math.min(Math.max(...p.map(v=>v.y)),height))))return failNumeric();
        } else for(let edge=0;edge<3;edge++) {
          const a=p[edge],b=p[(edge+1)%3],dx=b.x-a.x,dz=b.z-a.z,lengthSquared=dx*dx+dz*dz;
          const dot=(x-a.x)*dx+(z-a.z)*dz;
          if(!Number.isFinite(lengthSquared)||!Number.isFinite(dot))return failNumeric();
          const t=lengthSquared===0?0:Math.max(0,Math.min(1,dot/lengthSquared));
          const height=(1-t)*a.y+t*b.y;
          if(!accept(a.x+t*dx,a.z+t*dz,Math.max(Math.min(a.y,b.y),Math.min(Math.max(a.y,b.y),height))))return failNumeric();
        }
      }
      const selected=best as NearestSurfacePoint|null;
      if(selected)diagnostics.maxAcceptedDistanceM=Math.max(diagnostics.maxAcceptedDistanceM,selected.distanceM);
      return selected;
    },
    coversOriginalTriangle(points:readonly [SurfacePoint,SurfacePoint,SurfacePoint]):boolean {
      diagnostics.lastCoverageResidualArea=0;
      diagnostics.lastCoverageResidualAvailable=false;residualPolygons=[];
      if(diagnostics.disposed||!trustworthy||points.length!==3||!points.every(finite)) {diagnostics.invalidQueries++;return false;}
      const area=cross(points[0],points[1],points[2]);
      if(!Number.isFinite(area)||area===0) {diagnostics.invalidQueries++;return false;}
      const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minZ=Math.min(...points.map(p=>p.z)),maxZ=Math.max(...points.map(p=>p.z));
      const x0=Math.floor(minX/cellSize),x1=Math.floor(maxX/cellSize),z0=Math.floor(minZ/cellSize),z1=Math.floor(maxZ/cellSize),cells=(x1-x0+1)*(z1-z0+1);
      const failLimit=()=>{diagnostics.coverageLimitFailures++;return false;};
      if(![x0,x1,z0,z1,cells].every(Number.isSafeInteger)||cells>maxCells)return failLimit();
      const candidates=new Set<number>();let operations=0;
      for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++)for(const id of grid.get(`${x},${z}`)??[]) {if(++operations>maxOperations)return failLimit();candidates.add(id);}
      const anchor=points[0];
      let remaining:P[][]=[points.map(p=>({x:p.x-anchor.x,z:p.z-anchor.z}))];
      for(const id of candidates) {
        const t=triangles[id];if(t.maxX<minX||t.minX>maxX||t.maxZ<minZ||t.minZ>maxZ)continue;
        const local=t.p.map(p=>({x:p.x-anchor.x,z:p.z-anchor.z}));
        const next:P[][]=[];
        for(const piece of remaining) {
          let inside=piece;
          for(let e=0;e<3&&inside.length>=3;e++) {
            if((operations+=inside.length)>maxOperations)return failLimit();
            const a=local[e],b=local[(e+1)%3],outside=clip(inside,a,b,false);
            const inner=clip(inside,a,b,true);
            if(outside===null||inner===null) {diagnostics.numericCoverageFailures++;return false;}
            const outsideArea=polygonArea(outside);
            if(!Number.isFinite(outsideArea)) {diagnostics.numericCoverageFailures++;return false;}
            if(outside.length>=3&&outsideArea>0)next.push(outside);
            if(next.length>maxPieces)return failLimit();
            inside=inner;
          }
        }
        remaining=next;if(remaining.length===0) {diagnostics.lastCoverageResidualAvailable=true;return true;}
      }
      diagnostics.lastCoverageResidualArea=remaining.reduce((sum,p)=>sum+polygonArea(p),0);
      if(!Number.isFinite(diagnostics.lastCoverageResidualArea)) {diagnostics.numericCoverageFailures++;return false;}
      if(remaining.reduce((count,p)=>count+p.length,0)>maxOperations)return failLimit();
      const worldRemaining=remaining.map(polygon=>polygon.map(p=>({x:p.x+anchor.x,z:p.z+anchor.z})));
      if(!worldRemaining.every(polygon=>polygon.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.z)))) {diagnostics.numericCoverageFailures++;return false;}
      residualPolygons=worldRemaining;diagnostics.lastCoverageResidualAvailable=true;
      if(areaTolerance>0&&diagnostics.lastCoverageResidualArea<=areaTolerance) {diagnostics.approximateCoverageAcceptances++;return true;}
      diagnostics.coverageGapFailures++;return false;
    },
    dispose() {triangles.length=0;grid.clear();residualPolygons=[];diagnostics.lastCoverageResidualAvailable=false;diagnostics.disposed=true;},
  };
}
