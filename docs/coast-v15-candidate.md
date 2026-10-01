# R128 coherent rock candidate

This is an opt-in, authored approximation inspired by the supplied Tomari photograph's continuous fractured rock faces. The photograph supplies qualitative form, not survey dimensions. CPU validation does not establish photographic or GPU acceptance.

## API and integration

`structuralCoastHeight(x, z, y, baseHeightAt, sand, candidate = false)` and `cliffOutcrops(ground, bounds, candidate = false)` preserve the legacy path unless their final boolean is true. Root owns query gating, terrain construction, material/renderer changes, browser verification and integration. Keep TomariCoastSurface's existing 16 m raster-edge join fade and its nested strand interpolation. The helper has no raster-boundary argument and cannot independently enforce that caller-owned fade.

## Terrain domain

Candidate height changes apply only at 1.1 < source y < 62 m. The lower fade is 1.1–3.2 m; upper crown fade is 56–62 m. Both 10 m and 4 m central-difference source slopes must be steep: zero below respective gradients .85 and .65, reaching full strength at 1.35 and 1.15. Low sand fades out at strand-mask .12–.30. Strand is `sand * (1 - smoothstep(5,10,y))`, so a horizontal beach mask does not erase tall rock walls.

Shared panel and shelf directions continue to the dry toe. Candidate uses signed shallow erosion instead of the legacy lowered broad-toe profile. Absolute displacement is bounded by .55–1.90 m before domain weighting; the lower toe remains above the 1.1 m dry anchor. Seabed, low strand, gentle terrain and upper crown return their exact input height. Caller terrain triangles remain the rendering/collision source.

## Thin embedded ledges

Candidate retains closed 44-triangle bodies and their outward winding, while reducing group width, face height, extrusion and inter-piece gaps. Plate families predominate. Nominal normal depth is .18–.43 m, gaps .035–.110 m. Width is unequal across split pieces; colour is unchanged. This is geometry refinement, without painted shadows.

Each piece probes its corners, edge midpoints and centre for support. Pieces requiring >.24 m stand-off or >=3 m embed are rejected; backs start at .45 m rather than 4 m. Existing crown, strand and sea exclusions remain. This bounds embedding and avoids stretching slabs across unsupported clefts; finite support sampling is not a continuous terrain intersection proof.

One AABB per emitted closed body conservatively encloses all uploaded vertices, including embedded backs. These boxes are broad-phase proxies; their empty corners are not exact occupied solids. Integration must use actual closed body triangles for occupied-solid narrow-phase collision, rather than presenting proxy boxes as exact rock geometry.

## Local evidence

`node --experimental-strip-types --test tests/hero-cliff.test.ts`: 6 tests pass. `tsc --noEmit`: pass. Checks cover deterministic opt-in/default paths, signed finite bounded terrain relief, dry/shore/gentle negatives and fade continuity, closed/nondegenerate/outward body geometry, every vertex inside its proxy, and no body volumes on synthetic low strand/sea/gentle sand.

On unchanged legacy IslandElevation (not the final integrated candidate terrain): legacy 403 bodies / 17,732 triangles; candidate 477 bodies / 20,988 triangles (+3,256, below 80,000 cap). Maximum normal protrusion falls 2.133→.772 m; maximum group width falls 9.181→5.970 m. Candidate exposed central face area is 482.64 m², minimum exposed vertex height 4.650 m. Candidate support sampling rejects additional fragments; these statistics must be re-read after root wires the new terrain.

Remaining acceptance: beach/close/multiple-view GPU inspection, perceived ledge repetition, ground/ledge union appearance, actual collider narrow phase and all route checks. Whole project remains ACTIVE.
