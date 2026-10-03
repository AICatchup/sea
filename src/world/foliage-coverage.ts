/** Native connected components are selected intact: no invented surfaces or UV edits. */
export function representativeLeaves(positions: Float32Array, indices: Uint32Array, budget: number, resolution=128) {
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
        const e=[edge(a,b,x+.5,y+.5),edge(b,c,x+.5,y+.5),edge(c,a,x+.5,y+.5)];if(e.every(v=>v>=0)||e.every(v=>v<=0))pixels.add(axis*resolution*resolution+y*resolution+x);
      }
    }return {triangles,pixels};
  });
  const original=new Set(masks.flatMap(m=>Array.from(m.pixels))),covered=new Set<number>(),chosen:number[]=[];
  let remaining=budget;
  while(remaining>0){let best=-1,score=-1;for(let i=0;i<masks.length;i++){const m=masks[i];if(!m||m.triangles.length/3>remaining)continue;let gain=0;for(const p of m.pixels)if(!covered.has(p))gain++;const value=gain/(m.triangles.length/3);if(value>score){score=value;best=i;}}if(best<0)break;const m=masks[best];chosen.push(...m.triangles);remaining-=m.triangles.length/3;for(const p of m.pixels)covered.add(p);masks.splice(best,1);}
  const perAxis=(set:Set<number>)=>[0,1,2].map(axis=>Array.from(set).filter(p=>Math.floor(p/(resolution*resolution))===axis).length);
  return {indices:new Uint32Array(chosen),components:groups.size,singleTriangleComponents:Array.from(groups.values()).filter(g=>g.length===3).length,unsupported:chosen.length===0,originalPixels:perAxis(original),candidatePixels:perAxis(covered),resolution};
}
