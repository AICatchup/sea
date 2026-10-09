import * as THREE from 'three';

type Origin = Readonly<{ x: number; y: number; z: number }>;
export interface NativeBoundaryFeatherOptions {
  featherWidthM?: number;
  boundaryToleranceM?: number;
  gridCellSizeM?: number;
  maxVertices?: number;
  maxInputTriangles?: number;
  maxEdges?: number;
  maxBoundaryEdges?: number;
  maxGridReferences?: number;
  maxGridCells?: number;
  maxDistanceTests?: number;
  maxQueries?: number;
}
export interface NativeBoundaryFeatherDiagnostics {
  movedVertices: number; maxYMovement: number; boundaryEdges: number;
  queries: number; distanceTests: number; gridReferences: number;
  /** Authored boundary deformation; this does not certify survey accuracy. */
  authoredDeformation: true;
}

/** Borrowed indexed meshes and floor callback are never mutated. Retains all
 * original vertices, layers, attributes and XZ coordinates; only local Y is
 * authored within the native boundary band. Any failure returns no geometry. */
export function featherNativeSurfaceBoundary(
  cloud: THREE.BufferGeometry, cloudOrigin: Origin,
  footprint: THREE.BufferGeometry, footprintOrigin: Origin,
  originalNativeHeightAt: (worldX: number, worldZ: number) => number | null,
  options: NativeBoundaryFeatherOptions = {},
): { geometry: THREE.BufferGeometry; diagnostics: NativeBoundaryFeatherDiagnostics } {
  const o = { featherWidthM: 4, boundaryToleranceM: .00001, gridCellSizeM: options.featherWidthM ?? 4,
    maxVertices: 6_000_000, maxInputTriangles: 4_000_000, maxEdges: 6_000_000,
    maxBoundaryEdges: 100_000, maxGridReferences: 2_000_000, maxGridCells: 500_000,
    maxDistanceTests: 50_000_000, maxQueries: 6_000_000, ...options };
  for (const [k,v] of Object.entries(o)) {
    if (!Number.isFinite(v) || v < 0 || (k !== 'boundaryToleranceM' && v === 0)
      || (k.startsWith('max') && !Number.isSafeInteger(v))) throw new Error(`Invalid feather option ${k}`);
  }
  if (o.boundaryToleranceM >= o.featherWidthM) throw new Error('Feather tolerance exceeds band');
  for (const origin of [cloudOrigin, footprintOrigin])
    if (![origin.x,origin.y,origin.z].every(Number.isFinite)) throw new Error('Invalid feather origin');
  const validate = (g: THREE.BufferGeometry) => {
    const p=g.getAttribute('position'), idx=g.getIndex();
    if (!(p instanceof THREE.BufferAttribute) || !(p.array instanceof Float32Array) || p.itemSize!==3
      || !idx || idx.count%3 || !idx.count) throw new Error('Feather requires indexed Float32 triangles');
    if (p.count>o.maxVertices || idx.count/3>o.maxInputTriangles) throw new Error('Feather input budget exhausted');
    for(const v of p.array) if(!Number.isFinite(v)) throw new Error('Nonfinite feather position');
    for(let i=0;i<idx.count;i++) {
      const v=idx.getX(i); if(!Number.isInteger(v)||v<0||v>=p.count) throw new Error('Invalid feather index');
    }
    return {p,idx};
  };
  const c=validate(cloud), f=validate(footprint);
  type Edge = { ax:number; az:number; bx:number; bz:number; a:string; b:string; count:number };
  const edges=new Map<string,Edge>();
  const key=(id:number)=>`${f.p.getX(id)},${f.p.getY(id)},${f.p.getZ(id)}`;
  for(let i=0;i<f.idx.count;i+=3) {
    const ids=[f.idx.getX(i),f.idx.getX(i+1),f.idx.getX(i+2)];
    const ax=f.p.getX(ids[1]!)-f.p.getX(ids[0]!),az=f.p.getZ(ids[1]!)-f.p.getZ(ids[0]!);
    const bx=f.p.getX(ids[2]!)-f.p.getX(ids[0]!),bz=f.p.getZ(ids[2]!)-f.p.getZ(ids[0]!);
    if(ax*bz-az*bx===0) throw new Error('Degenerate footprint projection');
    for(let j=0;j<3;j++) {
      const ia=ids[j]!,ib=ids[(j+1)%3]!,a=key(ia),b=key(ib),k=a<b?`${a}|${b}`:`${b}|${a}`;
      const old=edges.get(k);
      if(old) {if(++old.count>2) throw new Error('Nonmanifold feather footprint');}
      else {
        if(edges.size>=o.maxEdges) throw new Error('Feather edge budget exhausted');
        edges.set(k,{a,b,count:1,ax:f.p.getX(ia)+footprintOrigin.x,az:f.p.getZ(ia)+footprintOrigin.z,
          bx:f.p.getX(ib)+footprintOrigin.x,bz:f.p.getZ(ib)+footprintOrigin.z});
      }
    }
  }
  const boundary=[...edges.values()].filter(e=>e.count===1);
  if(!boundary.length || boundary.length>o.maxBoundaryEdges) throw new Error('Missing boundary or feather boundary budget exhausted');
  const degree=new Map<string,number>();
  for(const e of boundary) for(const k of [e.a,e.b]) degree.set(k,(degree.get(k)??0)+1);
  if([...degree.values()].some(n=>n!==2)) throw new Error('Nonmanifold feather boundary');
  const d:NativeBoundaryFeatherDiagnostics={movedVertices:0,maxYMovement:0,boundaryEdges:boundary.length,
    queries:0,distanceTests:0,gridReferences:0,authoredDeformation:true};
  const grid=new Map<string,number[]>(), size=o.gridCellSizeM, width=o.featherWidthM;
  const cell=(x:number)=>{const n=Math.floor(x/size);if(!Number.isSafeInteger(n))throw new Error('Feather grid coordinate overflow');return n;};
  boundary.forEach((e,id)=>{
    const x0=cell(Math.min(e.ax,e.bx)-width),x1=cell(Math.max(e.ax,e.bx)+width);
    const z0=cell(Math.min(e.az,e.bz)-width),z1=cell(Math.max(e.az,e.bz)+width);
    const count=(x1-x0+1)*(z1-z0+1);
    if(!Number.isSafeInteger(count)||count>o.maxGridReferences-d.gridReferences)throw new Error('Feather grid reference budget exhausted');
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++) {
      const k=`${x},${z}`;let bucket=grid.get(k);
      if(!bucket){if(grid.size>=o.maxGridCells)throw new Error('Feather grid cell budget exhausted');bucket=[];grid.set(k,bucket);}
      bucket.push(id);d.gridReferences++;
    }
  });
  const positions=new Float32Array(c.p.array);
  for(let i=0;i<c.p.count;i++) {
    const x=c.p.getX(i)+cloudOrigin.x,z=c.p.getZ(i)+cloudOrigin.z;
    if(!Number.isFinite(x)||!Number.isFinite(z))throw new Error('Feather world position overflow');
    let distance=width;
    for(const id of grid.get(`${cell(x)},${cell(z)}`)??[]) {
      if(++d.distanceTests>o.maxDistanceTests)throw new Error('Feather distance budget exhausted');
      const e=boundary[id]!,dx=e.bx-e.ax,dz=e.bz-e.az;
      const t=Math.max(0,Math.min(1,((x-e.ax)*dx+(z-e.az)*dz)/(dx*dx+dz*dz)));
      distance=Math.min(distance,Math.hypot(x-e.ax-t*dx,z-e.az-t*dz));
    }
    if(distance>=width)continue;
    if(++d.queries>o.maxQueries)throw new Error('Feather query budget exhausted');
    const native=originalNativeHeightAt(x,z);
    if(native===null||!Number.isFinite(native))throw new Error('Missing/nonfinite native feather floor');
    const t=distance<=o.boundaryToleranceM?0:distance/width;
    const w=t*t*t*(10+t*(-15+6*t));
    const floor=native-cloudOrigin.y;
    const y=Math.fround(floor*(1-w)+c.p.getY(i)*w);
    if(!Number.isFinite(floor)||!Number.isFinite(y))throw new Error('Feather Float32 output overflow');
    positions[i*3+1]=y;
    const movement=Math.abs(y-c.p.getY(i));
    if(movement!==0){d.movedVertices++;d.maxYMovement=Math.max(d.maxYMovement,movement);}
  }
  const geometry=cloud.clone();
  try {
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    geometry.computeVertexNormals();
    for(const v of geometry.getAttribute('normal').array)if(!Number.isFinite(v))throw new Error('Feather normal overflow');
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    return {geometry,diagnostics:d};
  } catch(error) {geometry.dispose();throw error;}
}
