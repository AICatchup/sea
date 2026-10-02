# Receiver materials R140

CPU implementation and parameter/cache tests passed. GPU compilation, photographic comparison and perceptual acceptance remain root tasks; no GPU/photo PASS is claimed.

## Integration contract

`ReceiverBridge(scene, include, maxTextureSize, maxLayers, sand, options?)` accepts `{ extraMaterials?: () => readonly THREE.Material[], bedNormal?: THREE.Texture, bedARM?: THREE.Texture }`. The callback is read each sync; its ordering defines extra receiver IDs. `receiverExtraMaterialBase` equals the static geometry material count. `receiverBedMaterial` follows the extras. Source textures/materials are borrowed, never disposed. The bridge owns its synthetic bed material and its three packed textures.

`traceReceiverDetailed(origin, ray, maxDistance, out hitWorld, out normalWorld, out uv, out materialId, out vertexColor, out tangentWorld, out bitangentWorld)` adds a UV0 triangle basis transformed by the actual forward world matrix. Inverse-transpose remains reserved for normals. Reflection handedness is recovered from transformed bitangent. Degenerate UVs return zero basis and skip the normal map. The original `traceReceiver` signature remains available.

`receiverSurfaceColourDetailed(id, uv, vertexColor, p, normal, eye, tangent, bitangent)` applies normal maps; original `receiverSurfaceColour` uses zero basis and consequently skips normal maps. Root must supply detailed tangent outputs (or explicit bed tangent axes) for normal-map response.

Exactly two float samplers plus one array sampler remain. Parameters moved into the small dynamic texture after TLAS and instance records; `receiverMaterialOffset` references that texture. Static nodes/triangles are only uploaded on geometry rebuild. Parameter stride is 23 RGBA texels. Scalar wetness/color/emissive changes and source texture version changes do not rebuild geometry. Existing GeometryReceivers still keys its own signature on material.version; setting material.needsUpdate may therefore rebuild geometry. Scalar changes should use ordinary material property updates.

## Atlas and shading limits

Albedo, normal, AO, roughness, metalness and emissive maps have separate atlas layer IDs and independent native matrix, wrapping and upload-flip metadata. Identical texture objects share a layer (ARM maps naturally share). The atlas is raw `NoColorSpace`; only color maps flagged sRGB are explicitly decoded in GLSL, so normal/ARM bytes never receive gamma conversion. Tile size is 512; max texture/layer budget violations fail availability rather than dropping maps. Texture content changes require standard Three.js `texture.needsUpdate`; matrix and scalar material changes are read on every sync. Unsupported UV channels, object-space normals, unloaded maps and unsupported typed image encodings fail explicitly. Browser image/canvas color management and ImageBitmap creation options remain runtime limits. Custom shader materials are approximated via available standard fields; alpha/transmission surfaces remain outside GeometryReceivers coverage.

Tangent-space normal axes account for the normal map's own UV matrix, wrap mirror parity and upload flip. AO uses R, roughness G, metalness B. NormalScale and AO intensity are preserved. Sun color, shadow, refraction caustics and existing depth attenuation remain; the previous unconditional bed darkening and direct-light gain are removed.

Optional `receiverIBLGround`, `receiverIBLSky`, `receiverIBLStrength` accept linear hemispherical irradiance/environment colors. Unset/zero strength uses the prior bounded ground/sky estimate with approximate Fresnel specular IBL and AO. This is an analytic hemisphere approximation, not PMREM/cubemap IBL or a photographed environment. No new sampler is used. Root may bind these uniforms if measured scene lighting is available.

## Verification

`node node_modules/typescript/bin/tsc --noEmit` passed. The existing receiver bridge/geometry tests plus new material tests passed (16/16). New tests exercise independent gamma metadata and UV transforms, rejected channels/object normals, mixed extra-material IDs, scalar wetness static-upload preservation, texture epoch atlas refresh, layer-limit failure, and negative/nonuniform basis math. Canvas atlas tests use an explicit CPU mock; they do not establish browser/GPU image correctness.
