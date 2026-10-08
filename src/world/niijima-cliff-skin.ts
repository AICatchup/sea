import * as THREE from 'three';
import type {GroundSampler} from './contracts.ts';
import {niijimaStratifiedRelief} from './niijima-geological-surface.ts';

export interface CliffSkinOptions {
  zMin?:number; zMax?:number; eastX?:number; westX?:number;
  sampleX?:number; alongZ?:number; faceSteps?:number; chunkLength?:number;
  /** Requires replacing original render triangles and routing ground queries to this surface. */
  meso?:boolean;
  /** Inferred photo-informed beds; original sampled macroshape remains the anchor. */
  geology?:boolean;topLimit?:number;
}
export interface CliffSkinDiagnostics {
  sampledProfiles:number; rejectedProfiles:number; meshes:number; frontTriangles:number;
  triangles:number; maxRelief:number; maxCarving:number; buriedBoundaryVertices:number; backVertices:number;
  /** All depths verified by the provided DEM at the actual vertex coordinates. */
  minBackBurial:number; minBoundaryBurial:number;
  buildRejections?:Record<string,number>;
  firstBuildFailure?:{reason:string;point:number[];ground:number};
  maxBuriedBoundaryRetreat?:number;
}
export interface CliffSkin {
  group:THREE.Group; geometries:THREE.BufferGeometry[]; diagnostics:CliffSkinDiagnostics;
  surfaceHeightAt(x:number,z:number):number|null;
  coversOriginalTriangle(points:readonly [CliffPoint,CliffPoint,CliffPoint]):boolean;
  dispose():void;
}
interface Profile {z:number; heights:number[]; top:number}
export interface CliffPoint {x:number;y:number;z:number}
/** Indexed XZ barycentric query over front triangles. No Raycaster or monotonic-height assumption.
 * Input geometry must use frontTriangleCount and queryStrips metadata from this builder.
 */
export function createCliffSurfaceQuery(geometries:readonly THREE.BufferGeometry[]) {
  type Strip={z0:number;z1:number;start:number;end:number;minX:number;maxX:number;coreMinX:number;coreMaxX:number;top:number;g:THREE.BufferGeometry};
  const strips:Strip[]=geometries.flatMap(g=>(g.userData.queryStrips??[]).map((s:Omit<Strip,'g'>)=>({...s,g})));
  strips.sort((a,b)=>a.z0-b.z0);
  const bins=new Map<number,Strip[]>();for(const s of strips)for(let k=Math.floor(s.z0/4);k<=Math.floor(s.z1/4);k++){const a=bins.get(k)??[];a.push(s);bins.set(k,a);}
  type Triangle={ax:number;ay:number;az:number;bx:number;by:number;bz:number;cx:number;cy:number;cz:number;sa:number;sb:number;sc:number;det:number;strip:Strip};
  // A metre grid indexes projected triangle bounds, including every overhang
  // layer. Dense native studies no longer scan all vertical samples per floor
  // query or during multi-million-texel near-shore depth-map construction.
  const projected=new Map<number,Map<number,Triangle[]>>();
  for(const s of strips){
    const p=s.g.getAttribute('position'),idx=s.g.index!,source=s.g.userData.sourcePoints as number[];
    for(let i=s.start;i<s.end;i+=3){
      const a=idx.getX(i),b=idx.getX(i+1),c=idx.getX(i+2);
      const ax=p.getX(a),az=p.getZ(a),bx=p.getX(b),bz=p.getZ(b),cx=p.getX(c),cz=p.getZ(c);
      const det=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(det)<1e-10)continue;
      const triangle:Triangle={ax,ay:p.getY(a),az,bx,by:p.getY(b),bz,cx,cy:p.getY(c),cz,sa:source[a*3+1],sb:source[b*3+1],sc:source[c*3+1],det,strip:s};
      for(let z=Math.floor(Math.min(az,bz,cz)-1e-7);z<=Math.floor(Math.max(az,bz,cz)+1e-7);z++){
        const row=projected.get(z)??new Map<number,Triangle[]>();projected.set(z,row);
        for(let x=Math.floor(Math.min(ax,bx,cx)-1e-7);x<=Math.floor(Math.max(ax,bx,cx)+1e-7);x++){const cell=row.get(x)??[];cell.push(triangle);row.set(x,cell);}
      }
    }
  }
  const surfaceHeightAt=(x:number,z:number):number|null=>{
    if(!Number.isFinite(x)||!Number.isFinite(z))return null;let best=-Infinity,bestInside=false;
    for(const t of projected.get(Math.floor(z))?.get(Math.floor(x))??[]){
        const s=t.strip;if(z<s.z0||z>s.z1||x<s.minX||x>s.maxX)continue;
        const wa=((t.bz-t.cz)*(x-t.cx)+(t.cx-t.bx)*(z-t.cz))/t.det,wb=((t.cz-t.az)*(x-t.cx)+(t.ax-t.cx)*(z-t.cz))/t.det,wc=1-wa-wb;
        if(wa< -1e-7||wb< -1e-7||wc< -1e-7)continue;
        const sourceY=wa*t.sa+wb*t.sb+wc*t.sc;
        const height=wa*t.ay+wb*t.by+wc*t.cy;
        if(height>best){best=height;bestInside=sourceY>6&&sourceY<s.top-5&&x>s.coreMinX&&x<s.coreMaxX;}
    }return best===-Infinity||!bestInside?null:best;
  };
  const coversOriginalTriangle=(points:readonly [CliffPoint,CliffPoint,CliffPoint])=>{
    if(points.some(p=>![p.x,p.y,p.z].every(Number.isFinite)))return false;
    const low=Math.min(...points.map(p=>p.z)),high=Math.max(...points.map(p=>p.z));let covered=low;
    // Each triangle/slab intersection is convex. Its vertices are original vertices or
    // edge/slab intersections; checking them against one inner rectangle proves coverage.
    const candidates=new Set<Strip>();for(let k=Math.floor(low/4);k<=Math.floor(high/4);k++)for(const s of bins.get(k)??[])candidates.add(s);
    for(const s of [...candidates].sort((a,b)=>a.z0-b.z0)){if(s.z1<low||s.z0>high)continue;
      const lo=Math.max(low,s.z0),hi=Math.min(high,s.z1);if(lo>covered+1e-6)return false;
      const checks:CliffPoint[]=points.filter(p=>p.z>=lo&&p.z<=hi);
      for(let k=0;k<3;k++){const a=points[k],b=points[(k+1)%3];if(Math.abs(b.z-a.z)<1e-9)continue;for(const z of [lo,hi]){const t=(z-a.z)/(b.z-a.z);if(t>=0&&t<=1)checks.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z});}}
      if(!checks.length||checks.some(p=>p.x<=s.coreMinX+.01||p.x>=s.coreMaxX-.01||p.y<=6||p.y>=s.top-5))return false;
      covered=Math.max(covered,hi);
    }return covered>=high&&points.every(p=>surfaceHeightAt(p.x,p.z)!==null);
  };
  return {surfaceHeightAt,coversOriginalTriangle};
}
const cap=(v:number|undefined,d:number,lo:number,hi:number)=>Number.isFinite(v)?Math.max(lo,Math.min(hi,v!)):d;
const smooth=(v:number)=>{const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t);};
function hash(n:number){const a=Math.sin(n*127.1+311.7)*43758.5453;return a-Math.floor(a);}
function noise(v:number,seed:number){const n=Math.floor(v),t=smooth(v-n);return hash(n+seed)*(1-t)+hash(n+1+seed)*t;}
/** Continuous DEM-following solid shell; borrowed material remains owned by caller.
 * This is visual erosion detail, not a measured geological reconstruction.
 * UV dimensions are metres / 2.7, Z by cross-section arc length.
 */
export function createNiijimaCliffSkin(ground:GroundSampler,material:THREE.MeshStandardMaterial,options:CliffSkinOptions={}):CliffSkin {
  const zMin=cap(options.zMin,-1500,-1e5,1e5),zMax=Math.min(zMin+1600,cap(options.zMax,-650,zMin,1e5));
  const east=cap(options.eastX,6030,-1e5,1e5),west=Math.max(east-700,cap(options.westX,5680,-1e5,east));
  const sample=cap(options.sampleX,.85,options.geology?.25:.75,2),stepZ=cap(options.alongZ,1.25,options.geology?.25:1,3);
  const faceSteps=Math.floor(cap(options.faceSteps,144,16,options.geology?512:180)),chunkLength=cap(options.chunkLength,100,64,120);
  const group=new THREE.Group();group.name='shiromama-cliff-detail';group.userData.recon_part='shiromama-cliff-detail';
  const geometries:THREE.BufferGeometry[]=[];
  const diagnostics:CliffSkinDiagnostics={sampledProfiles:0,rejectedProfiles:0,meshes:0,frontTriangles:0,triangles:0,maxRelief:0,maxCarving:0,buriedBoundaryVertices:0,backVertices:0,minBackBurial:Infinity,minBoundaryBurial:Infinity};
  const xs:number[]=[];for(let x=east;x>west;x-=sample)xs.push(x);xs.push(west);
  const profile=(z:number):Profile|null=>{
    diagnostics.sampledProfiles++;
    const heights=xs.map(x=>ground.heightAt(x,z));
    let steep=0;for(let i=1;i<heights.length;i++)steep=Math.max(steep,(heights[i]-heights[i-1])/(xs[i-1]-xs[i]));
    const max=Math.max(...heights),min=Math.min(...heights);
    if(!heights.every(Number.isFinite)||max<10||max-min<8||steep<.35){diagnostics.rejectedProfiles++;return null;}
    return {z,heights,top:Math.min(cap(options.topLimit,180,20,180),max-.65)};
  };
  const iso=(p:Profile,y:number)=>{
    for(let i=1;i<xs.length;i++)if(p.heights[i]>=y&&p.heights[i-1]<y){const t=(y-p.heights[i-1])/(p.heights[i]-p.heights[i-1]);return xs[i-1]+(xs[i]-xs[i-1])*t;}
    return null;
  };
  const build=(rows:Profile[])=>{
    if(rows.length<2||geometries.length>=16||diagnostics.frontTriangles+2*(rows.length-1)*faceSteps>260000)return;
    let minBoundary=Infinity,minBack=Infinity,boundaryCount=0,maxRelief=0,maxCarving=0;
    const reject=(reason:string)=>{const counts=diagnostics.buildRejections??={};counts[reason]=(counts[reason]??0)+1;};
    const positions:number[]=[],uvs:number[]=[],sources:number[]=[],burials:number[]=[],front:number[]=[];
    const stride=faceSteps+1;
    for(let r=0;r<rows.length;r++){
      const p=rows[r];let arc=0,lastX=0,lastY=0;
      for(let j=0;j<=faceSteps;j++){
        const y=3+(p.top-3)*j/faceSteps,x=iso(p,y);if(x===null){reject('missing-height-crossing');return;}
        const xNext=iso(p,Math.min(p.top,y+.15))??x,xPrev=iso(p,Math.max(3,y-.15))??x;
        const dy=Math.min(p.top,y+.15)-Math.max(3,y-.15),slope=dy>0?(xNext-xPrev)/dy:0;
        const inv=1/Math.hypot(1,slope),nx=inv,ny=-slope*inv;
        const boundary=r===0||r===rows.length-1||j===0||j===faceSteps;
        const fade=smooth((y-3)/2)*smooth((p.top-y)/3)*smooth((p.z-rows[0].z)/3)*smooth((rows[rows.length-1].z-p.z)/3);
        // Uneven thin beds, interrupted recessed seams and localized rain grooves.
        const bedPhase=y/(.65+noise(p.z/31,51)*.35)+noise(p.z/9,71)*.45+noise(y/6.7,83)*.7;
        const bed= Math.exp(-Math.pow((bedPhase-Math.floor(bedPhase)-.18)/.11,2));
        const groove=Math.pow(noise(p.z/1.7+noise(y/13,11)*.6,97),8)*(.5+.5*noise(y/4,39));
        // Sparse multi-scale channels: unequal gaps, width/depth, branching drift and ends.
        let rain=0,ledge=0;
        if(options.meso){
          for(const [scale,seed] of [[7.3,501],[19.7,1501],[43.1,2501]]){
            let level=0;
            for(let cell=Math.floor(p.z/scale)-1;cell<=Math.floor(p.z/scale)+1;cell++){
              if(hash(cell+seed+31)<.28)continue;
              const center=cell*scale+hash(cell+seed)*scale*.92+(noise(y/(13+hash(cell+seed+9)*24),cell+seed+71)-.5)*scale*.29;
              const width=(.035+hash(cell+seed+81)**2*.12)*scale*(.55+noise(y/11,cell+seed+19));
              const start=10+hash(cell+seed+11)*Math.min(35,p.top*.36),end=p.top-7-hash(cell+seed+13)*Math.min(26,p.top*.25);
              const envelope=smooth((y-start)/(3+hash(cell+seed+15)*8))*smooth((end-y)/(4+hash(cell+seed+17)*12));
              const depth=.16+hash(cell+seed+23)**2*(scale<10?.55:1.05);
              level=Math.max(level,Math.exp(-Math.pow((p.z-center)/Math.max(.25,width),2))*envelope*depth);
            }
            rain+=level;
          }
          // Local absolute-height beds: broken protruding lips with a recessed underside.
          // Centers remain stable along Z; gaps and slight wandering prevent sinusoidal shelves.
          for(const [scale,seed] of [[3.7,3901],[8.9,4901]])for(let cell=Math.floor(y/scale)-1;cell<=Math.floor(y/scale)+1;cell++){
            if(hash(cell+seed+7)<.25)continue;
            const center=cell*scale+hash(cell+seed)*scale*.88+(noise(p.z/23,cell+seed+13)-.5)*.35;
            const width=.2+hash(cell+seed+17)*.42,delta=y-center;
            const continuity=smooth((noise(p.z/(9+hash(cell+seed+19)*18),cell+seed+23)-.2)/.45);
            ledge+=continuity*(.08+.12*hash(cell+seed+29))*(Math.exp(-((delta/width)**2))-.65*Math.exp(-(((delta+width*1.2)/(width*.75))**2)));
          }
        }
        const mesoFade=smooth((y-10)/6)*smooth((p.top-6-y)/8)*smooth((p.z-rows[0].z-5)/6)*smooth((rows[rows.length-1].z-p.z-5)/6);
        // nx is the horizontal component of the original DEM face normal: talus tends
        // toward an upward normal and gets almost no channel cutting or bed protrusion.
        const cliffWeight=smooth((nx-.45)/.35)**2;
        const geology=options.geology?niijimaStratifiedRelief(p.z,y):null;
        const relief=geology?mesoFade*cliffWeight*Math.max(-.8,Math.min(.3,-geology.retreat*.38-rain*.18)):
          options.meso?mesoFade*cliffWeight*Math.max(-1.4,Math.min(.22,ledge-rain-.06*groove)):
          fade*(.045+.14*bed-.07*groove+.025*(noise(y/2.1+p.z/4.3,29)-.5));
        const offset=boundary?-.35:relief-.025*(1-(options.meso?mesoFade:fade));
        // Keep adjacent vertical samples ordered even on a low cliff with many face steps.
        const yLimit=(p.top-3)/faceSteps*.2;
        // Meso cuts are horizontal into the DEM bank at fixed absolute bed heights.
        // This avoids flattening their visible depth on gently sloped macro faces.
        let fx=x+(options.meso?offset:nx*offset);const fy=options.meso?y-(options.geology?.08*(1-mesoFade):0):y+Math.max(-yLimit,Math.min(yLimit,ny*offset));
        if(boundary){ // Validate actual DEM burial rather than trusting interpolation.
          // End caps of a native profile may cross an inland trough before
          // reaching the bank. They remain buried and are never used for source
          // triangle removal. Bound the search by the declared western extent;
          // visible interior relief retains its independent metre limits.
          if(options.geology){
            while(fx>west&&ground.heightAt(fx,p.z)-fy<.015)fx-=.1;
            diagnostics.maxBuriedBoundaryRetreat=Math.max(diagnostics.maxBuriedBoundaryRetreat??0,x-fx);
          }else for(let n=0;n<(options.meso?4:8)&&ground.heightAt(fx,p.z)-fy<.015;n++)fx-=.25;
          const groundY=ground.heightAt(fx,p.z),burial=groundY-fy;if(!Number.isFinite(burial)||burial<.015){reject('unburied-boundary');diagnostics.firstBuildFailure??={reason:'unburied-boundary',point:[fx,fy,p.z],ground:groundY};return;}
          minBoundary=Math.min(minBoundary,burial);boundaryCount++;
        }
        let bx=options.meso?Math.min(x-1.5,fx-.8):x-1.5;
        while(bx>west&&ground.heightAt(bx,p.z)-y<.08)bx-=.5;
        const backBurial=ground.heightAt(bx,p.z)-y;
        if(!Number.isFinite(backBurial)||backBurial<.08||bx>=fx-.1){reject('unburied-back');return;}
        if(j)arc+=Math.hypot(fx-lastX,fy-lastY);lastX=fx;lastY=fy;
        positions.push(fx,fy,p.z);sources.push(x,y,p.z);burials.push(bx,y,p.z);
        uvs.push(p.z/2.7,arc/2.7);maxRelief=Math.max(maxRelief,Math.max(0,offset));maxCarving=Math.max(maxCarving,Math.max(0,-offset));
        minBack=Math.min(minBack,backBurial);
      }
    }
    for(let r=0;r<rows.length-1;r++)for(let j=0;j<faceSteps;j++){const a=r*stride+j,b=a+stride;front.push(a,a+1,b,a+1,b+1,b);}
    const count=positions.length/3,indices=[...front];for(const value of burials)positions.push(value);
    const uvCount=uvs.length;for(let i=0;i<uvCount;i++)uvs.push(uvs[i]);
    for(let i=0;i<front.length;i+=3)indices.push(front[i]+count,front[i+2]+count,front[i+1]+count);
    const edges=new Map<string,[number,number,number]>();
    for(let i=0;i<front.length;i+=3)for(let k=0;k<3;k++){const a=front[i+k],b=front[i+(k+1)%3],key=a<b?`${a},${b}`:`${b},${a}`,old=edges.get(key);edges.set(key,[a,b,(old?.[2]??0)+1]);}
    for(const [a,b,n]of edges.values())if(n===1)indices.push(b,a,a+count,b,a+count,b+count);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
    geometry.userData.frontVertexCount=count;geometry.userData.frontTriangleCount=front.length/3;geometry.userData.sourcePoints=sources;
    const queryStrips=[];
    if(options.meso)for(let r=0;r<rows.length-1;r++){
      if(rows[r].z<rows[0].z+4||rows[r+1].z>rows[rows.length-1].z-4)continue;
      const top=Math.min(rows[r].top,rows[r+1].top),p=geometry.getAttribute('position');
      const lower=Math.max(...[r,r+1].map(q=>Math.ceil((6-3)/(rows[q].top-3)*faceSteps)));
      const upper=Math.min(...[r,r+1].map(q=>Math.floor((top-5-3)/(rows[q].top-3)*faceSteps)));
      if(lower>=upper)continue;
      // Additional carving-sized guard keeps removal away from faded upper/lower bands.
      const coreMinX=Math.max(p.getX(r*stride+upper),p.getX((r+1)*stride+upper))+1.5,coreMaxX=Math.min(p.getX(r*stride+lower),p.getX((r+1)*stride+lower))-1.5;
      const rowXs=[];for(let q=r*stride;q<(r+2)*stride;q++)rowXs.push(p.getX(q));
      queryStrips.push({z0:p.getZ(r*stride),z1:p.getZ((r+1)*stride),start:r*faceSteps*6,end:(r+1)*faceSteps*6,minX:Math.min(...rowXs),maxX:Math.max(...rowXs),coreMinX,coreMaxX,top});
    }
    geometry.userData.queryStrips=queryStrips;
    const mesh=new THREE.Mesh(geometry,material);mesh.name=`shiromama-cliff-detail-${geometries.length}`;mesh.userData.worldSolid=true;mesh.userData.recon_part='shiromama-cliff-detail';group.add(mesh);geometries.push(geometry);
    diagnostics.frontTriangles+=front.length/3;diagnostics.triangles+=indices.length/3;
    diagnostics.minBoundaryBurial=Math.min(diagnostics.minBoundaryBurial,minBoundary);diagnostics.minBackBurial=Math.min(diagnostics.minBackBurial,minBack);diagnostics.buriedBoundaryVertices+=boundaryCount;diagnostics.backVertices+=count;diagnostics.maxRelief=Math.max(diagnostics.maxRelief,maxRelief);diagnostics.maxCarving=Math.max(diagnostics.maxCarving,maxCarving);
  };
  let rows:Profile[]=[];
  const n=Math.ceil((zMax-zMin)/stepZ),actual=n?(zMax-zMin)/n:stepZ;
  for(let i=0;i<=n;i++){
    const p=profile(zMin+i*actual);
    if(!p){build(rows);rows=[];continue;}
    rows.push(p);
    if(rows.length>1&&p.z-rows[0].z>=chunkLength){build(rows);rows=[p];}
  }
  build(rows);diagnostics.meshes=geometries.length;
  if(!geometries.length){diagnostics.minBackBurial=0;diagnostics.minBoundaryBurial=0;}
  let disposed=false;
  const query=createCliffSurfaceQuery(geometries);
  return {group,geometries,diagnostics,surfaceHeightAt(x,z){return disposed?null:query.surfaceHeightAt(x,z);},coversOriginalTriangle(points){return !disposed&&query.coversOriginalTriangle(points);},dispose(){if(disposed)return;disposed=true;for(const geometry of geometries)geometry.dispose();group.clear();}};
}
