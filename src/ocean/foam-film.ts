/** Authored centimetre-scale bubble films. Resolved pores alter transmission
 * and rim lighting; unresolved bubbles converge to their average appearance. */
export const foamFilmGLSL=/* glsl */`
vec2 foamFilm(vec2 world,float footprint,float concentration){
  const float scale=24.;vec2 p=world*scale,cell=floor(p);float closest=4.,winningRadius=.3;
  for(int z=-1;z<=1;z++)for(int x=-1;x<=1;x++){
    vec2 id=cell+vec2(float(x),float(z));
    vec2 center=id+.2+.6*vec2(hash(id+vec2(31,7)),hash(id+vec2(5,83)));
    float radius=.22+.16*hash(id+vec2(79,43));
    float distance=length(p-center)/radius;
    if(distance<closest){closest=distance;winningRadius=radius;}
  }
  // closest is measured in bubble radii, so filter width must use that unit
  // too. A cell-space width produces sparkling hard rims on small bubbles.
  float pixel=footprint*scale,resolved=1.-smoothstep(.2,1.15,pixel),aa=max(.08,pixel/winningRadius);
  float pore=1.-smoothstep(.48-aa,.85+aa,closest);
  float rim=1.-smoothstep(.10+aa,.44+aa,abs(closest-1.));
  float opacity=1.-pore*.48*(1.-pow(clamp(concentration,0.,1.),4.))*resolved;
  float shade=mix(1.,1.04+.24*rim-.36*pore,resolved);
  float mesoscale=mix(.5,noise(world*3.7+vec2(7.1,19.3)),exp(-pow(footprint*3.7,2.)));
  return vec2(opacity,shade*(.86+.28*mesoscale));
}
`;
