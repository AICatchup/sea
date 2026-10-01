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

## Retained-source results

At immutable `4613fcde06f6b8c953b5864d740c133d8b65f9f7`, all 232 tests,
TypeScript, Vite and embedded build passed. Three native pine materials were ready
in all three colour comparisons. Changed pixels at spawn/lookout/cliff were
14,607 / 29,930 / 11,361; original/corrected/original returned exactly identical
original images. This is a small leaf-colour improvement, not crown-density or
whole-image photographic acceptance.

The root recorded 255 fish in 1,676 actual RAF observations over 30.0141 wall
seconds (30.0019 simulation seconds), checking 427,125 adjacent frame pairs.
Observed maxima were 1.6 m/s horizontal, 0.6 m/s vertical and 1.8 rad/s heading
within floating-point tolerance. No nonfinite pose, dry-ground or observed-point
clearance failures occurred; minimum residual clearance was -8.42e-9 m, within
the sampled motion tolerance. Blocked movement was exercised. These are CPU pose
observations during rendering; physical full-body collision and real animal
behaviour remain unproven.

Fresh R132 checked the exact source, comparison nine PNGs, normal seven PNGs,
logs and recorded motion data once. It found no supported new P1/P2, supported
the bounded incremental correction, and explicitly retained photograph quality
FAIL. Native controls/full routes/Human were not accepted. R131 producer and
R132 reviewer completed turns and parent edges were verified as GPT-6.1 Sol low
with effective writable danger-full-access; the role names are not permission
or model evidence. The final documentation-only commit does not change rendering.
