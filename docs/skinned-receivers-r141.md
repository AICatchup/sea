# R141 posed first-person triangle receivers

`SkinnedReceivers` owns CPU arrays, borrows the SkinnedMesh geometry, skeleton and material list, and never updates those borrowed objects. Construct after initial `body.update`, `group.updateMatrixWorld(true)` and `mesh.skeleton.update()`. On each animated frame perform those caller operations, then `skinned.update()`, then merge/upload the shared dynamic receiver data.

## Integration contract

- `materials`: borrowed material objects in local index order. The bridge appends these to its existing material registry.
- `packed.data`: stable Float32Array across successful refits. Append to the existing `receiverDynamic` texture; do not create another sampler.
- `packed.root`: node index, or -1 for empty coverage.
- `packed.triangleOffset`: texel address relative to the start of this data.
- `packed.nodeOffset`: zero; nodes occupy three RGBA texels each. The first two contain world AABB min/left and max/right. The third contains triangle start/count.
- Triangles occupy twelve RGBA texels: world positions (first position .w is local material ID), world normals, UVs, vertex colors. Material -1 disables hidden or newly unsupported triangles.
- Bind uniforms `skinnedDataOffset` to the shared merged texture's append offset (texels), `skinnedTriangleOffset` to `packed.triangleOffset`, `skinnedRoot` to `packed.root`, `skinnedAvailable` to `diagnostics.available ? 1 : 0`.
- Include `skinnedReceiverTraceGLSL` after `receiverRead` and `receiverBox`; `receiverDynamic` must already be declared. `traceSkinnedReceiver` returns nearest double-sided triangle and outputs point, ray-facing normal, UV, **local** material ID, vertex color, tangent and bitangent. Caller adds `receiverExtraMaterialBase` for material decoding and compares its distance with regular receivers.
- `traceCPU` / `trace` provide a brute-force Three Ray oracle, independent of packed BVH traversal. Inputs are world origin, unit direction, world distance limit.

Skin positions use current skeleton boneMatrices with bindMatrix/bindMatrixInverse, then mesh.matrixWorld. Normals follow Three's weighted skin normal transformation followed by world normalMatrix, including attached/detached bind modes and negative/nonuniform world scale. Tangent/bitangent derive from the current deformed triangle and its UV derivatives; mirrored UV handedness is retained.

The initial topology build sorts once into an owned BVH. Subsequent updates deform unique vertices, write existing triangle slots and refit nodes in reverse allocation order. They neither sort/rebuild the BVH nor copy the static scene's triangle array. Geometry/index/attribute/material-list edits require reconstruction; such changes fail closed. Morphs, invalid/missing weights/index data, invalid indices, nonfinite inputs and singular mesh/bind/bone transforms also disable the entire receiver. Transparent/alpha-tested/alpha-map/transmissive materials are excluded and counted as triangle surfaces. Initially excluded materials require reconstruction to become covered. No proxy anatomy is substituted.

## CPU evidence

`node node_modules/typescript/bin/tsc --noEmit` passed. `node --experimental-strip-types --test tests/skinned-receivers.test.ts` passed 3 tests. The actual FirstPersonBody covers all seven material groups: 36,700 triangles, 19,372 vertices, 47 bones, 16,055 BVH nodes, depth 14, no excluded alpha surfaces. All seven actions × three poses × two rays produced 42 matching nearest hits against an independent source geometry/Three skinning oracle and packed BVH traversal. One topology build and 22 refits retained the exact same packed array. Negative/nonuniform transforms, attached/detached binds, inside hits, tangent orthogonality, visibility, budgets, morph rejection, singular transforms and disposal ownership also passed.

One CPU sample reported 23.2 ms last refit and 42.5 ms maximum during the action sweep; these are machine-specific Node timings and are not a browser frame-rate acceptance. Packed data is 7,817,040 bytes (488,565 RGBA texels); total owned typed arrays including deformed vertices/normals and cached bone skin matrices are 8,287,984 bytes. Diagnostics report current time, bytes, rebuilds/refits and availability.

Evidence ceiling: LOCAL_PASS. GPU compilation, rendered refracted body visibility, performance in browser, photo ACTIVE and HUMAN_GO remain root integration/visual review work. No DOM, browser, GPU or public claim is made by this component.
