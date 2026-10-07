import * as THREE from 'three';
import type {GroundSampler} from './contracts.ts';

export interface CliffSkinOptions {
  zMin?:number; zMax?:number; eastX?:number; westX?:number;
  sampleX?:number; alongZ?:number; faceSteps?:number; chunkLength?:number;
}
export interface CliffSkinDiagnostics {
  sampledProfiles:number; rejectedProfiles:number; meshes:number; frontTriangles:number;
  triangles:number; maxRelief:number; buriedBoundaryVertices:number; backVertices:number;
  /** All depths verified by the provided DEM at the actual vertex coordinates. */
  minBackBurial:number; minBoundaryBurial:number;
}
export interface CliffSkin {
  group:THREE.Group; geometries:THREE.BufferGeometry[]; diagnostics:CliffSkinDiagnostics;
  dispose():void;
}
interface Profile {z:number; heights:number[]; top:number}
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
  const sample=cap(options.sampleX,.85,.75,2),stepZ=cap(options.alongZ,1.25,1,3);
  const faceSteps=Math.floor(cap(options.faceSteps,144,16,180)),chunkLength=cap(options.chunkLength,100,64,120);
  const group=new THREE.Group();group.name='shiromama-cliff-detail';group.userData.recon_part='shiromama-cliff-detail';
  const geometries:THREE.BufferGeometry[]=[];
  const diagnostics:CliffSkinDiagnostics={sampledProfiles:0,rejectedProfiles:0,meshes:0,frontTriangles:0,triangles:0,maxRelief:0,buriedBoundaryVertices:0,backVertices:0,minBackBurial:Infinity,minBoundaryBurial:Infinity};
  const xs:number[]=[];for(let x=east;x>west;x-=sample)xs.push(x);xs.push(west);
  const profile=(z:number):Profile|null=>{
    diagnostics.sampledProfiles++;
    const heights=xs.map(x=>ground.heightAt(x,z));
    let steep=0;for(let i=1;i<heights.length;i++)steep=Math.max(steep,(heights[i]-heights[i-1])/(xs[i-1]-xs[i]));
    const max=Math.max(...heights),min=Math.min(...heights);
    if(!heights.every(Number.isFinite)||max<10||max-min<8||steep<.35){diagnostics.rejectedProfiles++;return null;}
    return {z,heights,top:Math.min(180,max-.65)};
  };
  const iso=(p:Profile,y:number)=>{
    for(let i=1;i<xs.length;i++)if(p.heights[i]>=y&&p.heights[i-1]<y){const t=(y-p.heights[i-1])/(p.heights[i]-p.heights[i-1]);return xs[i-1]+(xs[i]-xs[i-1])*t;}
    return null;
  };
  const build=(rows:Profile[])=>{
    if(rows.length<2||geometries.length>=16||diagnostics.frontTriangles+2*(rows.length-1)*faceSteps>260000)return;
    let minBoundary=Infinity,minBack=Infinity,boundaryCount=0,maxRelief=0;
    const positions:number[]=[],uvs:number[]=[],sources:number[]=[],burials:number[]=[],front:number[]=[];
    const stride=faceSteps+1;
    for(let r=0;r<rows.length;r++){
      const p=rows[r];let arc=0,lastX=0,lastY=0;
      for(let j=0;j<=faceSteps;j++){
        const y=3+(p.top-3)*j/faceSteps,x=iso(p,y);if(x===null)return;
        const xNext=iso(p,Math.min(p.top,y+.15))??x,xPrev=iso(p,Math.max(3,y-.15))??x;
        const dy=Math.min(p.top,y+.15)-Math.max(3,y-.15),slope=dy>0?(xNext-xPrev)/dy:0;
        const inv=1/Math.hypot(1,slope),nx=inv,ny=-slope*inv;
        const boundary=r===0||r===rows.length-1||j===0||j===faceSteps;
        const fade=smooth((y-3)/2)*smooth((p.top-y)/3)*smooth((p.z-rows[0].z)/3)*smooth((rows[rows.length-1].z-p.z)/3);
        // Uneven thin beds, interrupted recessed seams and localized rain grooves.
        const bedPhase=y/(.65+noise(p.z/31,51)*.35)+noise(p.z/9,71)*.45+noise(y/6.7,83)*.7;
        const bed= Math.exp(-Math.pow((bedPhase-Math.floor(bedPhase)-.18)/.11,2));
        const groove=Math.pow(noise(p.z/1.7+noise(y/13,11)*.6,97),8)*(.5+.5*noise(y/4,39));
        const relief=fade*(.045+.14*bed-.07*groove+.025*(noise(y/2.1+p.z/4.3,29)-.5));
        const offset=boundary?-.35:relief-.025*(1-fade);
        // Keep adjacent vertical samples ordered even on a low cliff with many face steps.
        const yLimit=(p.top-3)/faceSteps*.2;
        let fx=x+nx*offset;const fy=y+Math.max(-yLimit,Math.min(yLimit,ny*offset));
        if(boundary){ // Validate actual DEM burial rather than trusting interpolation.
          for(let n=0;n<8&&ground.heightAt(fx,p.z)-fy<.015;n++)fx-=.25;
          const burial=ground.heightAt(fx,p.z)-fy;if(!Number.isFinite(burial)||burial<.015)return;
          minBoundary=Math.min(minBoundary,burial);boundaryCount++;
        }
        let bx=x-1.5;
        while(bx>west&&ground.heightAt(bx,p.z)-y<.08)bx-=.5;
        const backBurial=ground.heightAt(bx,p.z)-y;
        if(!Number.isFinite(backBurial)||backBurial<.08||bx>=fx-.1)return;
        if(j)arc+=Math.hypot(fx-lastX,fy-lastY);lastX=fx;lastY=fy;
        positions.push(fx,fy,p.z);sources.push(x,y,p.z);burials.push(bx,y,p.z);
        uvs.push(p.z/2.7,arc/2.7);maxRelief=Math.max(maxRelief,Math.max(0,offset));
        minBack=Math.min(minBack,backBurial);
      }
    }
    for(let r=0;r<rows.length-1;r++)for(let j=0;j<faceSteps;j++){const a=r*stride+j,b=a+stride;front.push(a,a+1,b,a+1,b+1,b);}
    const count=positions.length/3,indices=[...front];positions.push(...burials);uvs.push(...uvs.slice());
    for(let i=0;i<front.length;i+=3)indices.push(front[i]+count,front[i+2]+count,front[i+1]+count);
    const edges=new Map<string,[number,number,number]>();
    for(let i=0;i<front.length;i+=3)for(let k=0;k<3;k++){const a=front[i+k],b=front[i+(k+1)%3],key=a<b?`${a},${b}`:`${b},${a}`,old=edges.get(key);edges.set(key,[a,b,(old?.[2]??0)+1]);}
    for(const [a,b,n]of edges.values())if(n===1)indices.push(b,a,a+count,b,a+count,b+count);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
    geometry.userData.frontVertexCount=count;geometry.userData.frontTriangleCount=front.length/3;geometry.userData.sourcePoints=sources;
    const mesh=new THREE.Mesh(geometry,material);mesh.name=`shiromama-cliff-detail-${geometries.length}`;mesh.userData.worldSolid=true;mesh.userData.recon_part='shiromama-cliff-detail';group.add(mesh);geometries.push(geometry);
    diagnostics.frontTriangles+=front.length/3;diagnostics.triangles+=indices.length/3;
    diagnostics.minBoundaryBurial=Math.min(diagnostics.minBoundaryBurial,minBoundary);diagnostics.minBackBurial=Math.min(diagnostics.minBackBurial,minBack);diagnostics.buriedBoundaryVertices+=boundaryCount;diagnostics.backVertices+=count;diagnostics.maxRelief=Math.max(diagnostics.maxRelief,maxRelief);
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
  return {group,geometries,diagnostics,dispose(){if(disposed)return;disposed=true;for(const geometry of geometries)geometry.dispose();group.clear();}};
}
