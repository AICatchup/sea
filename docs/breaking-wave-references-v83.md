# V83 — impact optical-density experiment (NOT accepted)

Base: 5241673. Added an authored 3D density field inside advected impact bounds, 12-sample Beer-Lambert integration and approximate self shadow. This is not FLIP, entrained-air physics or multiple scattering. Wave strength and V82 parcel flight remain unchanged.

## Sources checked
- https://github.com/XavierYribarren/webgpu-ocean — README describes MLS-MPM/SPH and screen-space fluid rendering, but unified spray/foam/bubbles is TODO. It is NOT evidence of a completed whitewater implementation. No source copied.
- https://www.sidefx.com/docs/houdini/fluid/sopwhitewater.html — particle/volume representations and density-dependent erosion inform the experiment; this does not validate our physical model.
- Existing Storm-Breakers, Crest and ballistic-sheet references remain documented in V81/V82.

## Visual rejection and isolation
Chrome side: 81 frames over 8 seconds, front: 8 checkpoints. Both use fixed 1/60 simulation steps, not realtime FPS measurement. No Chrome console errors. Captures show reduced hard shells but unacceptable smoke-like lumps, repeated rows, blue sheets and intersection seams. NOT photoreal and NOT a solved breaker.

The density trial is isolated behind BOTH `breakinglips=1&frothvolume=1`. Existing impact mesh rendering remains selected without frothvolume. Captures were made immediately before adding this selection flag, with the same density shader and parameters. Accepted standalone is unchanged. Goal remains ACTIVE.

129 focused tests, TypeScript and build passed before selection gating; TypeScript/build rechecked after gating. Raw evidence: work/v83-final-frames and work/v83-front-frames. Candidate media: outer outputs/breaking-waves-v83-candidate. No performance improvement claimed: 12 density samples with self-shadow are potentially expensive.

Next: fix source-to-water contact and persistent absorption before further optical tuning. Repeated impact lobes and a disconnected water sheet cannot be repaired by a softer shader. Full wave overturning, volume conservation, camera-inside volume and ray-depth clipping remain unresolved.
