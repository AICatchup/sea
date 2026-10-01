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
