# R135 actual geometry receivers

CPU implementation and packed traversal are LOCAL_PASS only. GPU compilation, matched Snell rays, silhouettes and photo-level continuous FPS remain unverified and are root integration acceptance work.

## Binding contract

Import `GeometryReceivers` from `src/ocean/geometry-receivers.ts` and `receiverTraceGLSL` from `geometry-receivers-glsl.ts`. Construct after the scene exists and `scene.updateMatrixWorld(true)`. Supply an explicit `include(mesh)` predicate and a human-readable `coverage` string. Root must exclude DEM (separate barycentric seabed), water, foliage, particles, first-person bodies and unsupported custom shaders. This class does not infer world coverage or camera coverage. Scene traversal discovers newly added selected meshes on subsequent refits. Invisible meshes or ancestors are omitted from TLAS; cached BLAS remains available. InstancedMesh `count` and `instanceMatrix` are read on every refit.

Spread `receivers.uniforms` into ShaderMaterial uniforms (share uniform objects). Inject `receiverTraceGLSL`. WebGL2 texelFetch is required; Three's WebGL2 GLSL1 compatibility prefix or explicit GLSL3 may be used. Signature:

`bool traceReceiver(vec3 worldOrigin, vec3 unitWorldRay, float maxDistance, out vec3 hitWorld, out vec3 normalWorld, out vec2 uv, out int materialId, out vec3 vertexColor)`

Nearest positive hit is double-sided; interpolated world normal faces against ray. The locally transformed ray is never normalized, so parametric distance stays in world metres under nonuniform and negative transforms. No camera depth or screen texture is read. maxDistance is exclusive; self-intersection threshold is 1e-5 metres.

Uniforms: `receiverNodes`, `receiverTLAS`, `receiverTriangles`, `receiverInstances` are float RGBA nearest-filter DataTextures; `receiverTextureWidth` is integer 1024; `receiverRoot` is integer TLAS node index; `receiverAvailable` is integer enable flag. Texture address is `(address % width, address / width)`. Root must check these texture dimensions against GPU MAX_TEXTURE_SIZE before binding; the configured 1M-triangle ceiling is a CPU budget, not a guaranteed portable GPU limit.

## Packed layout

Nodes use 3 texels: minimum XYZ / left child; maximum XYZ / right child; leaf start / count / 0 / 0. Count zero means internal. BLAS leaf start indexes packed triangles; TLAS leaf start indexes packed instances. BLAS and TLAS indices belong to separate textures.

Triangles use 12 texels: positions A/B/C (A.w = materialId), normals A/B/C, UV A/B/C (XY), vertex colors A/B/C (RGB). Missing normals use face normal, missing UV uses zero, missing color uses white. Attribute values are read using Three BufferAttribute accessors, including interleaved and normalized attributes. Geometry drawRange and material-array groups constrain included triangles; single-material meshes render drawRange independent of groups, matching Three behavior.

Instances use 8 texels: inverse-world matrix 4 columns, normal-matrix 3 columns, BLAS root / original instance index / 0 / 0. `.packed` exposes exactly the arrays backing textures for read-only inspection. `.materials[materialId]` borrows the actual Three Material, allowing root's albedo atlas to preserve map, base color and lighting. Registry indices can change on topology rebuild; update the root atlas when diagnostics.rebuilds changes.

## Update and failure behavior

`refit()` after `updateMatrixWorld(true)` updates TLAS and instance textures only; static BLAS and triangle texture identities remain unchanged. Topology signature detects selected mesh membership, geometry UUID, index/attribute identity/version/count, drawRange, groups, material UUID/version and alpha state. Changing attribute bytes requires `needsUpdate`, as in Three itself. These changes rebuild the complete bounded source instead of silently dropping triangles. Scene membership signature currently traverses selected scene objects each refit. TLAS uses median rebuilding (O(instances log instances)), not a persistent incremental tree. Transformed vertices are never flattened or uploaded per frame.

Defaults: <=1M unique triangles (shared geometry plus material assignment is cached), <=4096 active instances, BVH depth <=48, leaves <=8. Budget overflow, unaligned ranges, malformed indices, singular/non-finite transforms, non-finite vertex data, selected skin/morph geometry set diagnostics.available=false, reason and receiverAvailable=0. No partial receiver hits are returned. Reconstruct the receiver object after correcting a terminal failure. Transparent, opacity<1, alphaTest, alphaMap, transmission and invisible material surfaces are explicitly excluded and counted in diagnostics.excludedSurfaces; this count covers cached source triangles, not each instance. Custom ShaderMaterials need explicit caller exclusion because this tracer cannot interpret displacement/discard semantics.

Diagnostics includes coverage, available, reason, unique triangles, total nodes, active instances, texture allocation bytes, version, rebuilds and refits. All geometry and materials are borrowed. `dispose()` releases only the four owned textures and is idempotent.

## Validation

`node node_modules/typescript/bin/tsc --noEmit` passed. `node --experimental-strip-types --test tests/geometry-receivers.test.ts` passed 9 tests: nearer receiver before farther receiver, interior/double-sided, miss, UV/colors and groups/drawRange, instanced moving/nonuniform/negative transforms, count/visibility/topology changes, explicit exclusions, overflow unavailable, disposal ownership, GLSL residual contract, and packed TLAS/BLAS address/traversal interpretation versus an independent brute triangle CPU oracle. Packed CPU interpretation is not GPU acceptance.
