/** Conservative-state reconstruction before velocity division. Render-only;
 * the finite-volume solver retains nearest samples at cell centres. */
export type FoamFlowState=readonly [number,number,number];
export function reconstructFoamFlow(a:FoamFlowState,b:FoamFlowState,c:FoamFlowState,d:FoamFlowState,x:number,y:number):[number,number]{
 const state=[0,1,2].map(i=>(a[i]*(1-x)+b[i]*x)*(1-y)+(c[i]*(1-x)+d[i]*x)*y);
 if(state[0]<=.05)return [0,0];
 return [Math.max(-6,Math.min(6,state[1]/state[0])),Math.max(-6,Math.min(6,state[2]/state[0]))];
}
export const foamFlowGLSL=/* glsl */`
vec3 foamFlowState(vec2 uv){
  vec2 grid=clamp(uv*uShoreResolution-.5,vec2(0),vec2(uShoreResolution-1.));
  vec2 cell=min(floor(grid),vec2(uShoreResolution-2.)),f=grid-cell;
  vec2 p=(cell+.5)/uShoreResolution,e=vec2(1./uShoreResolution,0.);
  return mix(mix(texture2D(uShoreState,p).rgb,texture2D(uShoreState,p+e).rgb,f.x),
             mix(texture2D(uShoreState,p+e.yx).rgb,texture2D(uShoreState,p+e+e.yx).rgb,f.x),f.y);
}
`;
