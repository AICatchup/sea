# v13 instantaneous rolling crest ribbon

This opt-in candidate replaces the constant cyan crest sheet with a metric 3D curl and the existing ocean optics. It remains OFF by default in root configuration until front/side/underwater GPU review.

## Geometry and driver

One mesh / one draw, 96 x 96 cells per skin, 36,864 triangles total. The camera-centred patch is 32m across (0.333m spacing), with a 3m edge fade. Two opposite-winding skins are separated along the arc normal by 3.5% of radius. These form a thin ribbon; no watertight end caps, volume conservation, air entrainment solver or CFD are claimed.

At each source position, terrain uphill supplies the incident direction. Nine instantaneous FFT height samples inspect the preceding 4m, and a local parabola refines the peak position. A far-boundary maximum is rejected. No uniform time phase, spawned roller, readback, new texture or per-frame allocation is used. The search can change selected maxima where multiple peaks compete, so phase continuity is approximate and needs GPU video inspection.

The envelope requires positive crest, descending front, negative crest curvature, existing depth-cap dissipation, geographic shelter >= .18 and local depth strictly between .2 and 3.8m. Radius is bounded by min(1.25m, .36 * local depth, .9 * actual FFT crest) times this envelope. Material shoulder distance maps to an arc of up to 210 degrees: its last section passes the vertical and points back/down. A smooth join returns to the shared `shoreSolvedSurface` base, while instantaneous FFT crest/dissipation drives onset. Source wetness is required. The displaced lip is clipped against its own destination bed, rather than the lesser Eulerian base height, so an ahead-of-base curl is allowed to survive where it physically clears the bed.

## Root integration contract

Call `breaker.bindUniforms(oceanMaterial.uniforms)` with the **complete** live dictionary, plus any root-owned solver uniforms not already in that dictionary. Existing restricted binding lists are insufficient. Borrowed `IUniform` objects remain authoritative and are never disposed. Required families include FFT/choppiness/swell/wind, bathymetry/bounds/resolution/triangulation, all shore solver uniforms, scene color/depth/occlusion, resolution/nearFar, reflection/depth/matrices/resolution/readiness, solar shadow uniforms, underwater/wet/contact switches, sky/atmosphere/photographic-sky uniforms, water tint, time and exposure. The fragment declares the same uniforms as `oceanFragment`; there is no second environment definition.

Add the group to the ocean render scene, after the base water; its mesh uses renderOrder=1, normal depth testing/writing and DoubleSide. Update its camera XZ as before. `update(..., true)` now keeps the ribbon visible; the shared `uUnderwater` uniform selects existing underwater Fresnel/TIR/sky/scattering. Keep the existing root URL flag opt-in and OFF for ordinary navigation until visual review.

`CURVED_SURFACE` changes only this material. Base ocean shaders retain their existing contact and normal branches when this define is absent. Curl normals come from geometry screen derivatives; the height-only FFT and wet-stencil normals, forced upward Y, and duplicate Earth-curvature correction are bypassed. Normals orient to the correct camera medium. Shared reflection/refraction, exact dielectric Fresnel, solar visibility, capillary filtering, scatter and foam remain active; only a narrow aerated lip receives supplemental foam.

## Verification and counterexamples

CPU tests cover envelope calm/dry/deep/shelter/invalid negatives, finite metric geometry, true >180-degree descending lip, bounded radius section, base join, bilayer thickness, analytic arc normal orthogonality, instantaneous translated crest tracking, far search-boundary rejection, one draw/triangle count, borrowed uniform identity, underwater visibility and idempotent disposal. TypeScript checks pass. These cannot establish GLSL compilation, visual transparency, FFT activation rate, close-view silhouette smoothness, sorting, performance or underwater acceptance.

Root GPU review: use existing Habushi front shore pose looking seaward at eye height 1.5m, then move alongshore 5-10m and look tangentially across the same active crest, then move below water (~ -0.5m) looking up through that crest. Compare identical poses/time with crest OFF versus ON, shared solver ON and OFF, and reflection ON/OFF. Negative controls: swell=0, deep offshore >3.8m, dry land, sheltered cove <.18 and outside bathymetry bounds. On an active crest, front should transmit/scatter with ocean illumination; side should show a continuous face and returning lip; underwater should retain two-sided Fresnel/TIR and no cyan constant. Multiple competing maxima, tiny crests near radius zero, 0.333m mesh stair-stepping, patch-edge transition and separate-skin depth visibility remain explicit counterexamples to inspect.
