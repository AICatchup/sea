/** Match position and tangent only at the newly emitted water boundary.
 * Older parcels retain their ballistic motion. Units are metres and seconds. */
export const CREST_ATTACHMENT_SECONDS=.12;
export function crestAttachmentOffset(heightError:number,rateError:number,parcelAge:number):number {
  if(![heightError,rateError,parcelAge].every(Number.isFinite)||parcelAge>=CREST_ATTACHMENT_SECONDS)return 0;
  const s=Math.max(0,parcelAge)/CREST_ATTACHMENT_SECONDS;
  return heightError*(2*s*s*s-3*s*s+1)+rateError*CREST_ATTACHMENT_SECONDS*(s*s*s-2*s*s+s);
}
export const crestAttachmentGLSL=/*glsl*/`
float crestAttachmentOffset(float heightError,float rateError,float parcelAge){
  float s=clamp(parcelAge/${CREST_ATTACHMENT_SECONDS},0.,1.);
  return heightError*(2.*s*s*s-3.*s*s+1.)+rateError*${CREST_ATTACHMENT_SECONDS}*(s*s*s-2.*s*s+s);
}
`;
