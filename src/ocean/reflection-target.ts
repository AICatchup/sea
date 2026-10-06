import type * as THREE from 'three';

/** Resize the colour/depth pair before either attachment can be sampled. */
export function resizeReflectionTarget(target:THREE.WebGLRenderTarget,width:number,height:number):boolean{
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw new RangeError('Finite positive integer reflection dimensions required');
 const changed=target.width!==width||target.height!==height;
 const depth=target.depthTexture,staleDepth=!!depth&&(depth.image.width!==width||depth.image.height!==height);
 if(!changed&&!staleDepth)return false;
 if(changed)target.setSize(width,height);else target.dispose();
 // setSize invalidates the GPU pair, but Three leaves DepthTexture.image at its
 // previous dimensions until that target is rendered. Water may sample it first.
 if(depth){depth.image.width=width;depth.image.height=height;depth.needsUpdate=true;}
 return true;
}
