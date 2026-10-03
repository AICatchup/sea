# R151 base-level alpha coverage diagnostic

Opt-in `LeafVolumeRefinement.alphaAware` (default false) samples photographic diffuse alpha × alphaMap green × material opacity at the existing material cutoff. Texture matrix, channel-specific UV, flipY, repeat/mirrored/clamp and bilinear sampling are respected. Browser image pixels are cached once per texture. The existing default selection and default mid behavior remain unchanged. `preserveMidCoverage` independently restores the previous mid component displacement while refinement is enabled; it does not change far component selection.

Packaged near GLBs each contain 18,000 leaf triangles. Their diffuse images are JPEG (alpha 1). Three-axis 128² base-level photographic masks at budget 720:

- Canopy0 original [2638,2706,2770], geometric selection [600,623,605], alpha-aware [606,628,612].
- Canopy1 original [3608,2741,4012], geometric selection [786,663,795], alpha-aware [798,664,808].
- Canopy2 original [1863,1710,2316], geometric selection [506,506,585], alpha-aware [527,524,596].

At budget 2880 alpha-aware photo/original ratios are canopy0 0.586/0.595/0.577, canopy1 0.575/0.588/0.565, canopy2 0.661/0.704/0.676. Alpha-aware selection modestly improves real projected coverage but does not support alpha-background selection as the main sparse-crown cause. Near component removal still discards substantial visible coverage. Root should compare native packaged far leaves and isolate the removal of previous mid coverage adjustment in actual camera pixels.

These are CPU orthographic base-level union masks, not photo/GPU acceptance. They omit mip LOD, perspective, shading, alpha-to-coverage, depth, occlusion and camera-distance effects. Original here means packaged near model, not the unbundled original CC0 asset. No vertices, normals, UVs, material gain/cutoff, draws or source assets changed. Pine/shrub limits remain 2880/640.
