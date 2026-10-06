/** Continuous travel includes coastal solving; experimental geometry and
 * volumetric whitewater remain explicit comparison options. */
export function experienceOptions(search:string){
  const params=new URLSearchParams(search),habushi=params.get('experience')==='habushi';
  return {
    surf:params.has('surf')?params.get('surf')==='1':true,
    whitewater:params.has('whitewater')?params.get('whitewater')!=='0':true,
    volume:params.has('whitewater')?params.get('whitewater')==='volume':habushi,
    photoCoast:params.has('coast')?params.get('coast')==='photo':habushi,
    // Keep the traveller beside the existing vessel for the continuous voyage.
    // Gate/Secret bookmarks are explicit visual review entries only.
    view:params.get('view'),
  };
}
