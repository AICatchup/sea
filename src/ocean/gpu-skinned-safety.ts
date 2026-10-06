import type {SkinnedGPUExport,SkinnedGPUPose} from './skinned-receivers.ts';

export interface GPUSkinBound {position:number;normal:number;weight:number;boneStart:number;boneEnd:number;}
/** The fast path is Float32 and affine. Unsupported numerical cases retain the
 * CPU path; accepting a finite Matrix4 alone cannot prevent projective w=0. */
export function gpuSkinBounds(layout:SkinnedGPUExport):GPUSkinBound[]{
  for(const value of layout.staticPacked)if(!Number.isFinite(value))throw new Error('Non-finite packed source');
  return layout.surfaces.map((surface,index)=>{
    const bound={position:1,normal:0,weight:0,boneStart:surface.boneOffset,boneEnd:layout.surfaces[index+1]?.boneOffset??layout.bones};
    for(let i=0;i<surface.source.length;i+=14){
      for(let j=0;j<14;j++){const v=surface.source[i+j],f=Math.fround(v);if(!Number.isFinite(f)||(v!==0&&f===0))throw new Error('Source cannot be represented by the Float32 fast path');}
      for(let j=0;j<3;j++){bound.position=Math.max(bound.position,Math.abs(surface.source[i+j]));bound.normal=Math.max(bound.normal,Math.abs(surface.source[i+3+j]));}
      const normalLength=Math.hypot(surface.source[i+3],surface.source[i+4],surface.source[i+5]);
      let sum=0;for(let j=0;j<4;j++)sum+=Math.abs(surface.source[i+10+j]);
      if((normalLength>0&&normalLength<1e-15)||(sum>0&&sum<1e-15))throw new Error('Source normalization would underflow the Float32 fast path');
      bound.weight=Math.max(bound.weight,sum);
    }
    return bound;
  });
}

export function validateGPUSkinPose(bounds:readonly GPUSkinBound[],pose:SkinnedGPUPose):void{
  for(const data of [pose.bones,pose.worlds,pose.normals,pose.visible])for(const v of data)if(!Number.isFinite(v))throw new Error('Non-finite Float32 pose');
  for(let si=0;si<bounds.length;si++){
    const b=bounds[si],o=si*16,w=pose.worlds;
    if(w[o+3]!==0||w[o+7]!==0||w[o+11]!==0||w[o+15]!==1)throw new Error('Projective world transform requires CPU skinning');
    let bonePosition=0,boneNormal=0;
    for(let i=b.boneStart;i<b.boneEnd;i++)for(let row=0;row<3;row++){
      const p=i*16+row,linear=Math.abs(pose.bones[p])+Math.abs(pose.bones[p+4])+Math.abs(pose.bones[p+8]);
      boneNormal=Math.max(boneNormal,linear);bonePosition=Math.max(bonePosition,linear+Math.abs(pose.bones[p+12]));
    }
    let position=0,normal=0;
    for(let row=0;row<3;row++){
      const worldScale=Math.abs(w[o+row])+Math.abs(w[o+4+row])+Math.abs(w[o+8+row]);
      position=Math.max(position,worldScale*bonePosition*b.position*b.weight+Math.abs(w[o+12+row]));
      const n=si*12+row,normalScale=Math.abs(pose.normals[n])+Math.abs(pose.normals[n+4])+Math.abs(pose.normals[n+8]);
      normal=Math.max(normal,normalScale*boneNormal*b.normal*b.weight);
    }
    // Leave ample headroom for Float32 multiply/add and length() squared.
    if(!Number.isFinite(position)||!Number.isFinite(normal)||position>1e30||normal>1e15||(normal>0&&normal<1e-15))throw new Error('Pose arithmetic exceeds Float32 fast-path bounds');
  }
}
