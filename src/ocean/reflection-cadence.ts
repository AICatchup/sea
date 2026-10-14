import type {PerspectiveCamera} from 'three';

/** A stationary view may reuse its planar image. Moving the lens, changing
 * FOV, or crossing the interface invalidates that image and its matrices. */
export function refreshReflection(frame:number,camera:PerspectiveCamera,cached:PerspectiveCamera,underwater:boolean,cachedUnderwater:boolean,dirty:boolean):boolean{
  return dirty||frame%3===0||underwater!==cachedUnderwater||
    camera.position.distanceToSquared(cached.position)>1e-6||
    1-Math.abs(camera.quaternion.dot(cached.quaternion))>1e-7||
    Math.abs(camera.fov-cached.fov)>1e-5||Math.abs(camera.aspect-cached.aspect)>1e-6;
}
