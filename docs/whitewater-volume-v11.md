# Whitewater volume option

`new ShoreSpray(renderer, ground, { whitewater: true, volume: true })` selects
the volume renderer. `{whitewater:true}` retains the legacy plane fragments;
omitted options retain spray only. Root binds the URL option independently.

The existing 24×24 / 5 Hz RGBA readback remains the only readback. Finite
differences of its current bilinear wave height perturb onshore transport;
current compression supplies birth eligibility and initial thickness. Births
retain their own energy, direction and seed. Foam age collapses initial vertical
volume into a broader low strand, then breaks coverage into holes and expires.
Spray in volume mode launches from the elevated collapsing front region.

The fixed budget is 384 warped closed icosahedral flocs, 80 triangles each:
30,720 triangles and one volume draw plus the existing spray draw. Geometry,
typed attribute storage and shader material are allocated once. Frames update
the existing instance buffers. Object-space coverage and scale-correct normals
work across viewing angles; daylight uses the renderer's sun and horizon.
Opaque coverage writes depth and has holes rather than translucent mist shells.
The volume shader uses the same inverse horizontal displacement and
`shoreSolvedSurface` helper as the surface. Ground intersection, deep water,
sheltered coast, stale cache, nonfinite input and underwater views are gated.

This is an aerated rolling-floc approximation, not CFD, resolved entrainment,
resolved overturning or a barrel model. Normals, underside/cavity shading and
scene depth are used, but this shader does not sample a terrain shadow map.
Transport velocity is estimated from birth energy and coarse cached slope;
the cache does not contain measured fluid velocity. Compression already
contains shelter attenuation; CPU cache shelter remains 1 and the exact shader
coastal shelter gate provides an additional per-vertex limit.

Validation: 18 pool/geometry/material/integration tests passed, including
closed mesh topology, three-axis extent, finite state, budget/recycling,
compression thickness, slope-directed motion, collapse, invalid/deep/dry/
shelter culling, paused and underwater behavior, disposal, unchanged legacy
selection and single readback. TypeScript check passed. Actual GPU shader
compilation and photographed multi-angle acceptance are root-owned pending
checks, not established by these CPU tests.
