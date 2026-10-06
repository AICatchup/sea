/** Double precision 1D periodic reference of the GPU hydrostatic Rusanov step.
 * No sponge/friction/clamps: validates the conservative interior operator. */
export function referenceStep(h:number[],q:number[],bed:number[],dt:number,dx:number):{h:number[];q:number[]}{
 const n=h.length,g=9.81,flux=(i:number,j:number,normal:number)=>{
   const z=Math.max(bed[i],bed[j]),a=Math.max(0,h[i]+bed[i]-z),b=Math.max(0,h[j]+bed[j]-z);
   const u=h[i]>.00001?q[i]/h[i]:0,v=h[j]>.00001?q[j]/h[j]:0;
   const speed=Math.max(Math.abs(u)+Math.sqrt(g*a),Math.abs(v)+Math.sqrt(g*b));
   return [.5*((a*u+b*v)*normal-speed*(b-a)),.5*((a*u*u+.5*g*a*a+b*v*v+.5*g*b*b)*normal-speed*(b*v-a*u))+.5*g*(h[i]*h[i]-a*a)*normal];
 };
 const hn:number[]=[],qn:number[]=[];
 for(let i=0;i<n;i++){const r=flux(i,(i+1)%n,1),l=flux(i,(i+n-1)%n,-1);hn.push(h[i]-dt/dx*(r[0]+l[0]));qn.push(q[i]-dt/dx*(r[1]+l[1]));}
 return {h:hn,q:qn};
}

/** Experimental MUSCL free-surface/velocity reconstruction with SSP-RK2.
 * Bed remains piecewise constant; second-order accuracy is claimed only for
 * smooth flat-bed flow. No friction, sponge, or post-step positivity clamp. */
export function referenceMusclStep(h:number[],q:number[],bed:number[],dt:number,dx:number):{h:number[];q:number[]}{
 const n=h.length,g=9.81;
 const minmod=(a:number,b:number,c:number)=>a*b>0&&a*c>0?Math.sign(a)*Math.min(Math.abs(a),Math.abs(b),Math.abs(c)):0;
 const euler=(h:number[],q:number[])=>{
  const eta=h.map((v,i)=>v+bed[i]),velocity=h.map((v,i)=>v>.00001?q[i]/v:0);
  const slopes=(v:number[])=>v.map((a,i)=>minmod(1.5*(a-v[(i+n-1)%n]),.5*(v[(i+1)%n]-v[(i+n-1)%n]),1.5*(v[(i+1)%n]-a)));
  const de=slopes(eta).map((v,i)=>h[i]>.00001?v:0),du=slopes(velocity).map((v,i)=>h[i]>.00001?v:0);
  const flux=(i:number,j:number,normal:number)=>{
   const hi=Math.max(0,eta[i]+normal*.5*de[i]-bed[i]),hj=Math.max(0,eta[j]-normal*.5*de[j]-bed[j]);
   const ui=h[i]>.00001?velocity[i]+normal*.5*du[i]:0,uj=h[j]>.00001?velocity[j]-normal*.5*du[j]:0;
   const z=Math.max(bed[i],bed[j]),a=Math.max(0,hi+bed[i]-z),b=Math.max(0,hj+bed[j]-z);
   const speed=Math.max(Math.abs(ui)+Math.sqrt(g*a),Math.abs(uj)+Math.sqrt(g*b));
   return [.5*((a*ui+b*uj)*normal-speed*(b-a)),.5*((a*ui*ui+.5*g*a*a+b*uj*uj+.5*g*b*b)*normal-speed*(b*uj-a*ui))+.5*g*(hi*hi-a*a)*normal];
  };
  const hn:number[]=[],qn:number[]=[];
  for(let i=0;i<n;i++){const r=flux(i,(i+1)%n,1),l=flux(i,(i+n-1)%n,-1);hn.push(h[i]-dt/dx*(r[0]+l[0]));qn.push(q[i]-dt/dx*(r[1]+l[1]));}
  return {h:hn,q:qn};
 };
 const first=euler(h,q),second=euler(first.h,first.q);
 return {h:second.h.map((v,i)=>(h[i]+v)*.5),q:second.q.map((v,i)=>(q[i]+v)*.5)};
}

/** Mirror of rendering interpolation; dry bed elevations carry zero wet weight. */
export function referenceWetSurface(nodes:{bed:number;h:number;foam:number}[],weights:number[],queryBed:number):{eta:number;foam:number;depth:number}|null {
 let eta=0,foam=0,total=0;
 nodes.forEach((n,i)=>{if(n.h>=.01){eta+=(n.bed+n.h)*weights[i];foam+=n.foam*weights[i];total+=weights[i];}});
 if(total<.00001)return null;
 eta/=total;return {eta,foam:foam/total,depth:Math.max(0,eta-queryBed)};
}

/** Exact local coverage production/decay; advection is evaluated separately. */
export function foamCoverageStep(coverage:number,compressionBirth:number,dt:number):number {
 if(![coverage,compressionBirth,dt].every(Number.isFinite)||dt<=0)return coverage;
 const production=4*Math.max(0,Math.min(1,compressionBirth)),rate=.35+production,equilibrium=production/rate;
 return equilibrium+(Math.max(0,Math.min(1,coverage))-equilibrium)*Math.exp(-rate*dt);
}
