/** Authored centimetre-scale bubble films. Resolved pores alter transmission
 * and rim lighting; unresolved bubbles converge to their average appearance. */
export const foamFilmGLSL=/* glsl */`
vec2 foamFilm(vec2 world,float footprint,float concentration){
  const float scale=24.;vec2 p=world*scale;
  p+=.65*vec2(noise(world*7.3+vec2(13,5)),noise(world*5.8+vec2(71,29)));
  vec2 cell=floor(p),winningVector=vec2(0);float closest=4.,winningRadius=.3;
  for(int z=-1;z<=1;z++)for(int x=-1;x<=1;x++){
    vec2 id=cell+vec2(float(x),float(z));
    vec2 center=id+.05+.9*vec2(hash(id+vec2(31,7)),hash(id+vec2(5,83)));
    float radius=.12+.40*pow(hash(id+vec2(79,43)),2.);
    float distance=length(p-center)/radius;
    if(distance<closest){closest=distance;winningRadius=radius;winningVector=p-center;}
  }
  // closest is measured in bubble radii, so filter width must use that unit
  // too. A cell-space width produces sparkling hard rims on small bubbles.
  float pixel=footprint*scale*1.35,resolved=1.-smoothstep(.25,1.5,pixel/(2.*winningRadius)),aa=max(.08,pixel/winningRadius);
  float pore=1.-smoothstep(.48-aa,.85+aa,closest);
  float rim=1.-smoothstep(.10+aa,.44+aa,abs(closest-1.));
  float opacity=1.-pore*.48*(1.-pow(clamp(concentration,0.,1.),4.))*resolved;
  vec2 lightAxis=uSunDirection.xz/max(length(uSunDirection.xz),.001);
  float rimLight=.75+.25*dot(winningVector/max(length(winningVector),.0001),lightAxis);
  float shade=mix(1.,1.04+.24*rim*rimLight-.36*pore,resolved);
  float mesoscale=mix(.5,noise(world*3.7+vec2(7.1,19.3)),exp(-pow(footprint*3.7,2.)));
  return vec2(opacity,shade*(.86+.28*mesoscale));
}
`;
