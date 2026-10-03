# R148 leaf-volume diagnostic implementation

The optional last `loadDetailed(fullerUnderstory, leafVolumeRefinement=false)` argument keeps the V20 path unchanged by default. It also accepts `{pineTriangles:2880, shrubTriangles:640}` for explicit field-budget allocation; integer targets are limited to pine 1..2880 and shrub 1..640. Boolean true uses the existing smaller budget and is a diagnostic candidate, not a completed canopy. When enabled, far pine leaves are selected from the packaged near source, with the packaged far trunk/branch parts retained. Far shrubs select from near instead of an already simplified middle mesh. Original vertices, UVs, normals, materials and photographic maps are unchanged. Each selected position-welded component is kept whole, in its original orientation and available curvature; components are neither enlarged nor connected by invented geometry. Selection maximizes marginal triangle raster coverage from all three Cartesian directions. It keeps the existing part count/draw count.

Budgets: pine 720 leaf triangles plus the native far wood (195/195/185 triangles for canopy 0/1/2); shrub at most 96 or 160 triangles according to `fullerUnderstory`. If no whole component fits, the loader rejects explicitly rather than claiming coverage preservation. Every output carries component count, single-triangle component count and source/candidate projected pixels.

The CPU test reads GLB JSON and binary directly, without browser/image decode. At a 128 by 128 raster per axis, selected geometric coverage relative to near source is:

- canopy0: original 2719/2773/2850 pixels, candidate 616/635/619; 720 of 18000 leaf triangles, 22.7/22.9/21.7 percent.
- canopy1: original 3697/2826/4113, candidate 814/679/822; 720 of 18000, 22.0/24.0/20.0 percent.
- canopy2: original 1906/1767/2376, candidate 533/530/599; 720 of 18000, 28.0/30.0/25.2 percent.
- shrub0: original 1622/2239/1301, candidate 268/401/242; 157 of 2299, 16.5/17.9/18.6 percent.
- shrub1: original 1672/1701/1817, candidate 294/313/302; 158 of 2297, 17.6/18.4/16.6 percent.
- shrub2: original 2144/1185/1377, candidate 334/147/204; 156 of 2293, 15.6/12.4/14.8 percent.

These are geometric union masks, excluding photographic alpha, lighting, shadows, perspective and scene placement. The low retained ratios do not establish a connected photographic canopy or visual acceptance. A coarse 48-pixel raster incorrectly saturates to 100 percent for the middle pine source: it is unsuitable evidence. The 18000-triangle packaged near pine sources contain 14960/15090/15906 position-welded components; the middle source contains 3040/3147/2924 components in 3200 triangles. Much of the source is already disconnected triangles. This method preserves available topology; it cannot recover unavailable original leaf curvature/hierarchy. A truly connected canopy at these budgets remains unresolved.

Validation: five targeted geometry, resource and existing foliage-allocation tests pass; TypeScript noEmit passes. CPU evidence only; no GPU, screenshot acceptance, downloads, publication or provider actions.

## Measured budget curve and provenance counterevidence

The same packaged near-source and 128-square raster give these three-axis ratios at the larger budgets:

- canopy0 1440: .391/.405/.379; 2880: .584/.587/.568.
- canopy1 1440: .359/.374/.336; 2880: .577/.581/.566.
- canopy2 1440: .432/.472/.407; 2880: .656/.696/.667.
- shrub0 320 (actual 320): .303/.312/.296; 640 (actual 638): .485/.544/.463.
- shrub1 320 (actual 316): .325/.303/.295; 640 (actual 640): .537/.507/.535.
- shrub2 320 (actual 315): .300/.230/.262; 640 (actual 635): .506/.449/.466.

Pine total far counts are the selected leaf budget plus 195/195/185 woody triangles. At 2880, totals are 3075/3075/3065. Root must allocate fewer instances or redistribute the hard field triangle budget; no field caps change here. Shrub draws remain one per variant, pine draws remain three per variant. Higher counts still leave significant missing geometric coverage, and none establishes photo match.

The local `src/assets/foliage/cc0/canopy/provenance.json` records original CC0 leaf sources of 1060032/714744/1408704 triangles, reduced to 18000 in every packaged near model. The matching `canopy/fetch-canopy.mjs` applies metric/nonuniform crown scaling and whole-mesh `MeshoptSimplifier.simplifyWithAttributes(... ['Permissive'])` independently for near/mid/far. `cc0/provenance.json` records shrub original counts 7590/5242/9234, reduced to 2299/2297/2293 near triangles by `scripts/fetch-foliage.mjs`, also Permissive. Therefore all measurements above compare against packaged NEAR, **not original CC0**. Original raw buffers are not bundled, so original-CC0 topology/coverage is unavailable locally. No downloads were performed. Preserving the remaining disconnected triangles is truthful; claiming recovery of the original native connected leaf hierarchy is unsupported.
