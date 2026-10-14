# Breaking waves V81 — experimental, not visually accepted

V81 follows V80 (`51a0608`). The normal experience still does not enable `breakinglips`; `?breakinglips=1` is an experimental comparison. No claim of photorealism, volume conservation or completed large plunging breakers is made.

## External implementation and paper used

- [Storm-Breakers](https://github.com/Stormrider31/Storm-Breakers): depth-dependent deformation, grouped waves and coupled horizontal/vertical motion. Its Unity implementation is not copied wholesale into Three.js.
- [Crest shoreline guidance](https://github.com/wave-harmonic/crest/blob/master/docs/user/shallows-and-shorelines.rst): shallow-water and shoreline limitations; not evidence that this implementation achieves them.
- [Thuerey et al. 2007, Real-time Breaking Waves for Shallow Water Simulations](https://matthias-research.github.io/pages/publications/breakingWaves.pdf), section 5: distinguish detecting a steep front from placing emission at the crest; overlap emitted water with its source and retain gravity-driven particle motion. SEA remains a partial kinematic approximation.

## Changes

- A connected front uses one physical clock instead of per-column artificial delays.
- Root projection accumulates from its previous corrected position with bounded 1/60 second integration, rather than restarting from the birth prediction.
- After detecting fresh compression, search backwards to the first local crest maximum; sample the lower forward face for fall distance.
- Slightly overlap emitted rows with the crest. Retain actual falling positions when visibility fades rather than flattening them into a synthetic connecting wall.
- Deterministic per-node seeds avoid identical whitewater shapes along a front.
- Weld whitewater geometry before recalculating normals. Previously non-indexed face normals gave each triangle separate rock-like lighting. The triangle count is unchanged.
- Fade the whitewater/water intersection by clearance before depth clipping exposes individual triangles.

## Verification

- 127 focused tests passed; TypeScript and production build passed. Existing bundle-size/dynamic-import warnings remain.
- Chrome: 81 frames from 0 to 8 seconds at 0.1 second capture intervals, simulation integrated at 1/60 second. Readbacks settled; this is not realtime performance evidence.
- Reviewed side-view frames through growth, impact and spreading; additional earlier front/side views retained under work. Final GIF/MP4 are diagnostic candidates, not promotional or accepted release media.
- Local media: `outputs/breaking-waves-v81-candidate/` in the parent workspace. Raw frames and metadata: `work/v81-final-frames/`.

## Remaining acceptance failures

The falling blue membrane still sometimes reads as a strip, not a convincing large overturning crest. Foam can form regular lumps and hard joins remain. Changes to source geometry and wave/parcel coupling require further continuous multi-view comparison. Do not solve this by reducing wave strength or disabling the experiment and declaring success. No accepted release/standalone promotion is performed.
