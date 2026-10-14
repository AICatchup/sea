# V86 — emitted speed and moving contact surface (experimental)

Base 69b8470. The wave forcing and swell remain unchanged.

## Changes and source
- Sheet velocity now scales with source elevation and tracked front speed, following the form of equation 9 in [Thuerey et al.](https://matthias-research.github.io/pages/publications/breakingWaves.pdf). Gain 0.08 and the 24 m/s resource bound are authored parameters, not measured Niijima values. Thickness decreases with the speed ratio as a simple flux approximation. This is not a resolved pressure or mass-conserving solver.
- Connected-breaker contact uses two consecutive world-aligned readbacks to extrapolate water height for at most 0.2 seconds. Ground remains fixed. Vertical extrapolation rate is limited to 8 m/s; no extra GPU readbacks are requested. The additional history is one bounded 32 KiB buffer for the existing 64x64 two-plane cache. Reset/failure/disposal clear it.
- [Storm-Breakers](https://github.com/Stormrider31/Storm-Breakers) Ocean.cs was also rechecked for coupled displacement/velocity; its source was not copied.

## Evidence and limitations
132 focused tests, TypeScript and build passed. The new cache test checks moving-water height, unchanged ground, capped prediction horizon and reset invalidation. Tests do not prove realistic waves.

Coarse side checkpoints of the velocity+prediction trial yielded 71/128 contacts before 0.15 seconds and mean fall 0.298 m, versus V85's 115/128 and 0.0216 m. These are diagnostic subsets, not a general improvement metric; capture cadence and asynchronous sampling matter. Raw trial: work/v86-side-frames. Final thinner-sheet side81: work/v86-final-frames. Final front8: work/v86-front-frames. Fixed 1/60 step, not realtime FPS. Candidate media in outer outputs/breaking-waves-v86-candidate.

Visual acceptance still FAILS. Projection produces detached strips and angular intersections; full large curling breakers are not established. Extrapolation is approximate and cannot replace current GPU contact data. A thin sheet does not make the remaining topology correct. Normal experience and accepted standalone unchanged; breakinglips stays experimental. Goal ACTIVE.
