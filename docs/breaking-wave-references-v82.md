# V82 — emission state and landing lifetime (experimental)

Base: V81 `deb4236`. This is not a visually accepted release. `breakinglips=1` remains required for the experimental water sheets; the normal experience is unchanged.

## What changed

- Each crest emission stores its own horizontal and upward velocity. New water uses a bounded, smoothed estimate of the tracked crest velocity; old water retains its emission state.
- GPU root correction acts only on newly emitted water, and stops after separation. It no longer bends the full airborne sheet to the latest heightfield.
- First tip contact stops feeding the sheet. Younger emitted water remains in gravitational flight instead of disappearing after a fixed 0.16-second fade. A bounded lifetime remains as a resource guard.
- Reflections use interpolated normals derived from the parcel surface instead of a separate flat normal for every raster triangle.

The physical interpretation follows the emission/ballistic-sheet construction discussed in [Thuerey et al.](https://matthias-research.github.io/pages/publications/breakingWaves.pdf). External implementation references and limitations remain in [V81](breaking-wave-references-v81.md). This is still a kinematic approximation, not a mass-conserving 3D fluid simulation.

## Evidence and limits

129 focused tests, TypeScript and production build passed. A new test verifies fixed emitted velocity under later crest acceleration. Another verifies gravitational acceleration of younger sheet water after source separation. These tests do not establish visual realism.

Chrome side view: 81 frames, 0..8 seconds, 1/60-second integration, 10fps output, settled readbacks. Final front view: 8 checkpoints over the same duration. This is fixed-step capture, not realtime performance evidence. Raw frames/metadata are in `work/v82-final-frames` and `work/v82-front-frames`; candidate GIF/MP4 are in parent-workspace `outputs/breaking-waves-v82-candidate`.

Visual review still fails the goal: large convincing overturning is not established; foam can resemble pointed lumps, and strips/polygon intersections remain. There is no promotion to an accepted standalone release. Next work must address contact geometry and overlapping whitewater, then repeat continuous multi-view validation. Do not reduce wave strength or hide the experiment and call the goal complete.
