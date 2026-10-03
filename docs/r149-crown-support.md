R149 native crown support (LOCAL_PASS)

Opt-in AssetWorld crownSupport defaults false. Existing V20 placement matrices are unchanged when false. After native foliage load, the opt-in path rebuilds fixed fields once and restores dynamic pines. LOD capacities remain pine 24/180, shrub 48/180 and triangle budgets 3.6M/1.35M. Renderer and original GLBs/textures are untouched.

Native near GLB extents: pine variants x widths 5.885/5.501/4.631m, heights 4.875/3.800/3.196m; shrubs widths 1.139/1.211/1.588m, heights 1.249/1.050/.850m. Native trunk feet are measured from the lowest 0.16m of trunk geometry; baked source coordinates are used directly. Placement yaw, scale and clustered density are seeded. Actual native crown width determines pitch; slope, height and protected beach/start/landmark corridors reject placements. Lower vertical cliff and sand remain open.

Terrain support uses a 0.35m native leaf lower-envelope grid (87–200 pine samples / 13–15 shrub samples) plus transformed cell padding and terrain corner checks. Pine support lift <=0.08m; shrub <=0.45m. This is a conservative sampled support model, not an exact triangle-ground intersection proof. No proxy dimensions determine ready native placement. CPU initial/fallback stays original proxy placements until native load succeeds.

Actual connected IslandElevation(true,true,true) test: 10,101 support candidates, 7,465 accepted, 2,636 rejected; conservative sampled leaf minimum clearance .035m. Crown native world-bounds footprint coverage sampled at 4m: 5,655 / 8,699 eligible soil samples = 65.007%. This is overlapping native bounds footprint union, not alpha-aware leaf coverage or photo similarity. Crown circle area sum 79,152.73m2 includes overlaps.

Tests: native source GLB geometry + actual connected terrain; deterministic repeat; low sand / steep slope / start corridor exclusions; frozen false-option V20 placement negative control. Both tests passed; tsc --noEmit passed. Browser/GPU evaluation remains root-owned; photoPass false.
