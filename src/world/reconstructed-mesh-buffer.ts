import {BufferAttribute,BufferGeometry,Vector3} from 'three';

export interface ReconstructedMeshDescriptor {
  vertices:number;
  triangles:number;
  origin:readonly [number,number,number];
  positionsBytes:number;
  indicesBytes:number;
}
export interface ReconstructedMeshDecodeOptions {
  maxVertices?:number;
  maxTriangles?:number;
  maxBufferBytes?:number;
}
export const RECONSTRUCTED_MESH_DEFAULT_LIMITS=Object.freeze({maxVertices:1_000_000,maxTriangles:2_000_000,maxBufferBytes:128*1024*1024});
const hardLimits={maxVertices:4_000_000,maxTriangles:8_000_000,maxBufferBytes:256*1024*1024};
function positiveInteger(value:number,name:string):number {
  if(!Number.isSafeInteger(value)||value<=0)throw new Error(`Invalid reconstructed mesh ${name}: expected a positive safe integer`);
  return value;
}

/** Decode exactly little-endian Float32 XYZ followed by Uint32 triangle indices.
 * Copies into owned typed arrays: callers retain their ArrayBuffer and may reuse
 * or mutate it after return. Positions remain relative to the returned origin.
 * Caller owns/disposes the returned geometry; no borrowed resource is disposed.
 * Counts, byte lengths and values are rejected rather than silently repaired.
 */
export function decodeReconstructedMeshBuffer(buffer:ArrayBuffer,descriptor:ReconstructedMeshDescriptor,options:ReconstructedMeshDecodeOptions={}) {
  if(!(buffer instanceof ArrayBuffer))throw new Error('Invalid reconstructed mesh buffer: expected ArrayBuffer');
  if(!descriptor||typeof descriptor!=='object')throw new Error('Invalid reconstructed mesh descriptor');
  const limits:{maxVertices:number;maxTriangles:number;maxBufferBytes:number}={...RECONSTRUCTED_MESH_DEFAULT_LIMITS};
  for(const key of ['maxVertices','maxTriangles','maxBufferBytes'] as const) {
    const supplied=options[key];
    if(supplied!==undefined) {
      positiveInteger(supplied,key);
      if(supplied>hardLimits[key])throw new Error(`Reconstructed mesh ${key} exceeds hard allocation budget`);
      limits[key]=supplied;
    }
  }
  const vertices=positiveInteger(descriptor.vertices,'vertices'),triangles=positiveInteger(descriptor.triangles,'triangles');
  if(vertices>limits.maxVertices||triangles>limits.maxTriangles)throw new Error('Reconstructed mesh count exceeds allocation budget');
  const positionsBytes=positiveInteger(descriptor.positionsBytes,'positionsBytes'),indicesBytes=positiveInteger(descriptor.indicesBytes,'indicesBytes');
  if(positionsBytes%4!==0||indicesBytes%4!==0||positionsBytes!==vertices*12||indicesBytes!==triangles*12)throw new Error('Reconstructed mesh byte layout does not match counts and 4-byte alignment');
  const total=positionsBytes+indicesBytes;
  if(!Number.isSafeInteger(total)||total>limits.maxBufferBytes)throw new Error('Reconstructed mesh bytes exceed allocation budget');
  if(buffer.byteLength!==total)throw new Error('Reconstructed mesh buffer length does not exactly match descriptor');
  const sourceOrigin=descriptor.origin;
  if(!Array.isArray(sourceOrigin)||sourceOrigin.length!==3||!sourceOrigin.every(v=>typeof v==='number'&&Number.isFinite(v)))throw new Error('Invalid reconstructed mesh origin: expected three finite coordinates');
  const origin=new Vector3(sourceOrigin[0],sourceOrigin[1],sourceOrigin[2]);
  const view=new DataView(buffer);
  // Validate before allocating derived geometry, normals or bounds.
  for(let i=0;i<vertices*3;i++)if(!Number.isFinite(view.getFloat32(i*4,true)))throw new Error(`Nonfinite reconstructed mesh coordinate at component ${i}`);
  for(let i=0;i<triangles*3;i++)if(view.getUint32(positionsBytes+i*4,true)>=vertices)throw new Error(`Invalid reconstructed mesh index at element ${i}`);
  const positions=new Float32Array(vertices*3),indices=new Uint32Array(triangles*3);
  for(let i=0;i<positions.length;i++)positions[i]=view.getFloat32(i*4,true);
  for(let i=0;i<indices.length;i++)indices[i]=view.getUint32(positionsBytes+i*4,true);
  const geometry=new BufferGeometry();
  try {
    geometry.setAttribute('position',new BufferAttribute(positions,3));
    geometry.setIndex(new BufferAttribute(indices,1));
    geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
    // Finite input alone does not ensure finite Float32 normal arithmetic.
    const normals=geometry.getAttribute('normal');
    for(let i=0;i<normals.count;i++)if(!Number.isFinite(normals.getX(i))||!Number.isFinite(normals.getY(i))||!Number.isFinite(normals.getZ(i)))throw new Error('Nonfinite reconstructed mesh derived normals');
    const box=geometry.boundingBox!,sphere=geometry.boundingSphere!;
    if(![box.min.x,box.min.y,box.min.z,box.max.x,box.max.y,box.max.z,sphere.center.x,sphere.center.y,sphere.center.z,sphere.radius].every(Number.isFinite))throw new Error('Nonfinite reconstructed mesh derived bounds');
    return {geometry,origin};
  } catch(error) {geometry.dispose();throw error;}
}
