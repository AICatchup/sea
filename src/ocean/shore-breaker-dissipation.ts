/** CPU reference for the optional GLSL observable; no runtime consumer yet. */
export function shoreBreakerDissipation(rawFftHeight:number,ground:number,exposure:number,swell:number,wind:number):number {
  const depth=-ground;
  if(![rawFftHeight,ground,exposure,swell,wind].every(Number.isFinite)
    ||depth<.2||depth>3.8||exposure<.18||exposure>1||rawFftHeight<=0||rawFftHeight>=1e6
    ||swell<=0||swell>4||wind<0||wind>35)return 0;
  const transport=Math.max(1,Math.min(8,18/Math.max(depth,1)))**.125;
  const nominalAmplitude=Math.max(.08,swell*(.1+wind*wind*.013));
  const cap=Math.min(1,.38*depth/nominalAmplitude);
  // All accepted depths except .2..22 already have a unit shoreline fade.
  const x=Math.max(0,Math.min(1,(depth-.015)/(.22-.015)));
  const uncappedCrest=rawFftHeight*swell*transport*x*x*(3-2*x)*exposure;
  const height=2*uncappedCrest,limit=.73*depth;
  if(height<=limit)return 0;
  return Math.max(0,Math.min(1,1-cap*cap,1-(limit/height)**2));
}
