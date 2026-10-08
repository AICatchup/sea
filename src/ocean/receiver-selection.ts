import * as THREE from 'three';

/** Height fields use the shared barycentric bed sampler; deforming plants use
 * the raster depth. Neither belongs in the static opaque geometry table. */
export function isStaticOpticalReceiver(mesh:THREE.Mesh):boolean{
 if(mesh instanceof THREE.SkinnedMesh||mesh.geometry.morphAttributes.position?.length||mesh.userData.marinePlant||mesh.userData.foliageLod||mesh.userData.surface||mesh.userData.heightfieldSurface||/DEM|forest|pine|foliage|needles|sprays|shrub|seagrass|leaf|leaves|cloud/i.test(mesh.name))return false;
 for(let p:THREE.Object3D|null=mesh;p;p=p.parent)if(p.userData.foliageLod||p.userData.heightfieldSurface)return false;
 const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
 if(materials.some(m=>!(m instanceof THREE.MeshStandardMaterial||m instanceof THREE.MeshBasicMaterial)))return false;
 return materials.some(m=>m.visible&&!m.transparent&&m.opacity>=1&&m.alphaTest===0&&(!('alphaMap' in m)||!m.alphaMap)&&(!('transmission' in m)||m.transmission===0));
}
