/** CPU base-level photographic coverage; not a GPU mip/alpha-to-coverage simulation. */
export interface LeafAlphaLayer {
  width: number; height: number; data: ArrayLike<number>; uvs: Float32Array;
  component: 1 | 3; matrix: readonly number[]; flipY: boolean;
  wrapS: number; wrapT: number;
}
export interface LeafAlphaSampling { layers: readonly LeafAlphaLayer[]; threshold: number; opacity: number; }
function wrapped(value: number, mode: number): number {
  if (mode === 1000) return value - Math.floor(value); // RepeatWrapping
  if (mode === 1002) { const cell=Math.floor(value), fraction=value-cell; return Math.abs(cell % 2)===1 ? 1-fraction : fraction; }
  return Math.max(0,Math.min(1,value)); // ClampToEdgeWrapping
}
export function sampleLeafAlpha(layer: LeafAlphaLayer, u: number, v: number): number {
  const m=layer.matrix, x=wrapped(m[0]*u+m[3]*v+m[6],layer.wrapS);
  let y=wrapped(m[1]*u+m[4]*v+m[7],layer.wrapT); if(layer.flipY)y=1-y;
  // GPU normalized bilinear sampling at texel centers, including seams.
  const px=x*layer.width-.5, py=y*layer.height-.5, ix=Math.floor(px), iy=Math.floor(py);
  const coordinate=(i:number,size:number,mode:number)=>Math.min(size-1,Math.floor(wrapped((i+.5)/size,mode)*size));
  const texel=(a:number,b:number)=>layer.data[(coordinate(b,layer.height,layer.wrapT)*layer.width+coordinate(a,layer.width,layer.wrapS))*4+layer.component]/255;
  const fx=px-ix,fy=py-iy;
  return (texel(ix,iy)*(1-fx)+texel(ix+1,iy)*fx)*(1-fy)+(texel(ix,iy+1)*(1-fx)+texel(ix+1,iy+1)*fx)*fy;
}
/** Native connected components are selected intact: no invented surfaces or UV edits. */
export function representativeLeaves(positions: Float32Array, indices: Uint32Array, budget: number, resolution=128, alpha?: LeafAlphaSampling) {
  const parent=Uint32Array.from({length:positions.length/3},(_,i)=>i);
  const find=(i:number):number=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const join=(a:number,b:number)=>{parent[find(b)]=find(a);};
  const weld=new Map<string,number>();
  for(let i=0;i<parent.length;i++){const key=Array.from(positions.subarray(i*3,i*3+3),v=>Math.round(v*1e5)).join(',');const old=weld.get(key);if(old!==undefined)join(i,old);else weld.set(key,i);}
  for(let i=0;i<indices.length;i+=3){join(indices[i],indices[i+1]);join(indices[i],indices[i+2]);}
  const groups=new Map<number,number[]>();
  for(let i=0;i<indices.length;i+=3){const key=find(indices[i]),group=groups.get(key)??[];group.push(indices[i],indices[i+1],indices[i+2]);groups.set(key,group);}
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<positions.length;i++){min[i%3]=Math.min(min[i%3],positions[i]);max[i%3]=Math.max(max[i%3],positions[i]);}
  const project=(vertex:number,axis:number)=>{const a=(axis+1)%3,b=(axis+2)%3;return [(positions[vertex*3+a]-min[a])/Math.max(1e-9,max[a]-min[a])*(resolution-1),(positions[vertex*3+b]-min[b])/Math.max(1e-9,max[b]-min[b])*(resolution-1)];};
  const masks=Array.from(groups.values(),triangles=>{
    const pixels=new Set<number>();
    for(let axis=0;axis<3;axis++)for(let i=0;i<triangles.length;i+=3){
      const [a,b,c]=triangles.slice(i,i+3).map(v=>project(v,axis));
      const edge=(p:number[],q:number[],x:number,y:number)=>(x-p[0])*(q[1]-p[1])-(y-p[1])*(q[0]-p[0]);
      for(let y=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1])));y<=Math.min(resolution-1,Math.ceil(Math.max(a[1],b[1],c[1])));y++)for(let x=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0])));x<=Math.min(resolution-1,Math.ceil(Math.max(a[0],b[0],c[0])));x++){
        const e=[edge(a,b,x+.5,y+.5),edge(b,c,x+.5,y+.5),edge(c,a,x+.5,y+.5)];if(e.every(v=>v>=0)||e.every(v=>v<=0)) {
          if(alpha) {
            const area=edge(b,c,a[0],a[1]); if(Math.abs(area)<1e-12)continue;
            const weights=[e[1]/area,e[2]/area,e[0]/area]; let value=alpha.opacity;
            for(const layer of alpha.layers){let u=0,v=0;for(let k=0;k<3;k++){const vertex=triangles[i+k];u+=layer.uvs[vertex*2]*weights[k];v+=layer.uvs[vertex*2+1]*weights[k];}value*=sampleLeafAlpha(layer,u,v);}
            if(value<alpha.threshold)continue;
          }
          pixels.add(axis*resolution*resolution+y*resolution+x);
        }
      }
    }return {triangles,pixels};
  });
  const original=new Set(masks.flatMap(m=>Array.from(m.pixels))),covered=new Set<number>(),chosen:number[]=[];
  let remaining=budget;
  while(remaining>0){let best=-1,score=-1;for(let i=0;i<masks.length;i++){const m=masks[i];if(!m||m.triangles.length/3>remaining)continue;let gain=0;for(const p of m.pixels)if(!covered.has(p))gain++;if(alpha&&gain===0)continue;const value=gain/(m.triangles.length/3);if(value>score){score=value;best=i;}}if(best<0)break;const m=masks[best];chosen.push(...m.triangles);remaining-=m.triangles.length/3;for(const p of m.pixels)covered.add(p);masks.splice(best,1);}
  const perAxis=(set:Set<number>)=>[0,1,2].map(axis=>Array.from(set).filter(p=>Math.floor(p/(resolution*resolution))===axis).length);
  return {indices:new Uint32Array(chosen),components:groups.size,singleTriangleComponents:Array.from(groups.values()).filter(g=>g.length===3).length,unsupported:chosen.length===0,originalPixels:perAxis(original),candidatePixels:perAxis(covered),resolution,measurement:alpha?'base-level alpha-product projected coverage':'geometric projected coverage'};
}
