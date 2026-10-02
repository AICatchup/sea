# R143 exact CPU skinning and refit repair

LOCAL_PASS only. Dedicated checkout based on 1aba; no browser, GPU, runtime process, or publication operations performed.

The actual FirstPersonBody retains 19,372 vertices, 36,700 triangles, 47 bones and the fixed 16,055-node BVH. Bone palette composition, bind transforms, homogeneous xyz skinning, world transform, inverse-transpose world normals and normalization retain their previous authoritative Three semantics. Every changed pose still skins every vertex and refits every node.

Changes:

- Decode source positions, normals, four weights and four palette addresses once through Three attribute getters into Float64 storage. This preserves normalized and interleaved inputs without runtime getter calls per vertex. Identity, count and version checks fail closed before reuse. In-place changes must use Three's needsUpdate contract; attribute/topology changes require reconstruction.
- Accumulate the twelve matrix coefficients consumed by position/normal xyz explicitly, retaining influence order and double precision. The unused homogeneous matrix row is omitted.
- Pack immutable UV/color texels once. Check the full packed data once; later frames validate every posed coordinate and normal, while refit bounds select those already finite values.
- Scan all three coordinates together per leaf, and evaluate surface visibility/material support once per update. No deformation approximation, reduced topology or pose throttling.

Node benchmark: tests/skinned-speed.test.ts, 70 poses/action, first 10 discarded, 60 measured. Timings include update skinning, triangle packing, refit and bookkeeping, but exclude body animation. Baseline and final executions used the same Node executable and fixture sequentially on this machine. Milliseconds median / p95 / maximum:

- idle: before 17.42 / 20.68 / 34.81; after 8.10 / 9.45 / 9.95.
- walk: before 17.21 / 25.76 / 28.62; after 8.29 / 11.24 / 24.55.
- run: before 25.21 / 33.33 / 51.52; after 8.06 / 9.30 / 9.67.
- swim: before 24.95 / 29.95 / 30.50; after 7.96 / 8.83 / 9.53.
- dive: before 24.21 / 29.93 / 31.07; after 12.11 / 14.62 / 15.27.
- helm: before 24.78 / 29.91 / 30.75; after 12.27 / 14.27 / 14.51.
- climb: before 26.29 / 30.25 / 31.12; after 11.39 / 14.67 / 15.29.

Memory accounting increases from 8,287,984 to 10,457,648 bytes, including the 2,169,664-byte decoded cache. This trades static CPU memory for getter/validation work per moving pose. Timing is descriptive, with no flaky performance threshold in tests. Cold JIT and system scheduling still produce outliers; these results do not establish browser frame/GPU improvement.

Validation: five targeted correctness tests pass, including independent source oracle 7 actions x 3 poses x 2 rays = 42 matching hits; negative/nonuniform transforms; attached/detached binds; replacement and unsupported cases; normalized byte weights/interleaved positions; in-place version changes for position, weight, index, normal and UV. One actual-body benchmark test passes. TypeScript noEmit passes. Root owns integration and actual browser/GPU comparison.
