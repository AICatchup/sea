import type {AdventureState} from './contracts.ts';
export const WALK_FOV = 62;
export const BOAT_FOV = Object.freeze({default:78,min:65,max:95});
export function clampBoatFov(value:number,fallback:number=BOAT_FOV.default):number {
  return Number.isFinite(value)?Math.max(BOAT_FOV.min,Math.min(BOAT_FOV.max,value)):fallback;
}
export function boatWheelFov(current:number,deltaY:number,deltaMode:number):number {
  if(!Number.isFinite(deltaY)||![0,1,2].includes(deltaMode))return current;
  const pixels=deltaY*(deltaMode===1?16:deltaMode===2?160:1);
  return clampBoatFov(current+Math.sign(pixels)*Math.min(8,Math.abs(pixels)*.02),current);
}
export function targetCameraFov(state:Pick<AdventureState,'mode'|'avatarAction'|'seatingBlend'>,boatFov:number):number {
  const blend=Number.isFinite(state.seatingBlend)
    ?Math.max(0,Math.min(1,state.seatingBlend!)):state.mode==='boat'?1:0;
  return WALK_FOV+(clampBoatFov(boatFov)-WALK_FOV)*blend;
}
export function approachCameraFov(current:number,target:number,delta:number):number {
  if(!Number.isFinite(current))return target;
  if(!Number.isFinite(delta)||delta<=0)return current;
  const next=current+(target-current)*(1-Math.exp(-Math.min(.1,delta)*8));
  return Math.abs(next-target)<.01?target:next;
}
