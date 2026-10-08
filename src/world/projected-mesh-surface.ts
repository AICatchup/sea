import type { BufferGeometry, Vector3 } from 'three';

export type SurfacePoint = Readonly<{x:number;y:number;z:number}>;
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
  const diagnostics={inputTriangles:0,indexedTriangles:0,degenerateTriangles:0,invalidTriangles:0,gridEntries:0,gridCells:0,buildLimitExceeded:false,coverageLimitFailures:0,coverageGapFailures:0,numericCoverageFailures:0,approximateCoverageAcceptances:0,numericalAreaTolerance:areaTolerance,lastCoverageResidualArea:0,invalidQueries:0,disposed:false};
  const triangles:Triangle[]=[],grid=new Map<string,number[]>();
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
    coversOriginalTriangle(points:readonly [SurfacePoint,SurfacePoint,SurfacePoint]):boolean {
      diagnostics.lastCoverageResidualArea=0;
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
        remaining=next;if(remaining.length===0)return true;
      }
      diagnostics.lastCoverageResidualArea=remaining.reduce((sum,p)=>sum+polygonArea(p),0);
      if(!Number.isFinite(diagnostics.lastCoverageResidualArea)) {diagnostics.numericCoverageFailures++;return false;}
      if(areaTolerance>0&&diagnostics.lastCoverageResidualArea<=areaTolerance) {diagnostics.approximateCoverageAcceptances++;return true;}
      diagnostics.coverageGapFailures++;return false;
    },
    dispose() {triangles.length=0;grid.clear();diagnostics.disposed=true;},
  };
}
