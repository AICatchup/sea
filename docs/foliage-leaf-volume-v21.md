# R148 leaf-volume diagnostic implementation

The optional last `loadDetailed(fullerUnderstory, leafVolumeRefinement=false)` argument keeps the V20 path unchanged by default. When enabled, far pine leaves are selected from the packaged near source, with the packaged far trunk/branch parts retained. Far shrubs select from near instead of an already simplified middle mesh. Original vertices, UVs, normals, materials and photographic maps are unchanged. Each selected position-welded component is kept whole, in its original orientation and curvature; components are neither enlarged nor connected by invented geometry. Selection maximizes marginal triangle raster coverage from all three Cartesian directions. It keeps the existing part count/draw count.

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
