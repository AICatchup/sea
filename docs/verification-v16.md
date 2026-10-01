# V16 retained fish motion and foliage photo sampling

The active objective remains UNMET: multiple views visibly retain CG characteristics.
This change reuses the completed one-pass R123/R124 observations; it adds no broad
research iteration. Root owns rendering, integration, the preview and publication.

Fish use retained position/heading with bounded movement and sampled swept seabed
clearance instead of resetting to their school centre at shallow terrain. Authored
species, counts, geometry and resources are retained. See `fish-motion-r131.md` for
exact limits, clock-discontinuity behaviour and sampled-clearance limits.

Native leaf photo colour is now downsampled in linear light with alpha weights,
extending colour into invisible black atlas padding. Native alpha, cutoff,
topology, placement, collision and lighting are unchanged. The two photo-mip
controls check invisible padding and linear-light colour averaging. This adds
three owned RGBA mip chains (about 16 MiB CPU colour data total for 1K atlases);
source textures remain available for DEV comparison and disposal. Runtime asset
loading must be checked: CPU tests use proxies and cannot establish native GLB
readiness.

DEV `captureLeafComparison` compares original/corrected/original colour at one
frozen pose, time, light and instance set. It rejects unavailable native maps and
shares the atomic capture gate. `observeFishMotion` records actual RAF observations
of normal retained CPU poses, with a 1..40 second bound; it does not read GPU buffers,
prove real animal behaviour, native controls or Human acceptance. Both restore the
saved camera/settings. Diagnostics expose native foliage readiness and LOD counts.

An early root colour-map implementation attempted to reprocess a shared material
after its map had already become a DataTexture; asset loading then used proxies.
The shared-material guard fixes that failure. Early `spawn-colour` and
`lookout-colour` images with zero corrected materials are EXCLUDED. Accepted
comparisons use `*-colour-fixed` names and three available native pine materials.

Retained-source execution, fixed-pose image comparison, actual fish time series,
fresh review and exact publication readback are reported in the release manifest.
Historical walk/dive/boarding/voyage evidence is not promoted to new full-route
verification. Remaining canopy gaps, flat green cover, cliff toes/ledges, water
colour, static HDR clouds, biological placement and complete Niijima coast remain
separate requirements; this incremental change does not certify photorealism.
