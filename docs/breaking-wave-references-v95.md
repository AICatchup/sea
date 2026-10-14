# V95 — track the steep front separately from its emission crest

Base: 4d3899f. Reference: [Thuerey et al., Real-time Breaking Waves for Shallow Water Simulations](https://matthias-research.github.io/pages/publications/breakingWaves.pdf), sections 4–6, equation 9. No external source code copied.

The previous implementation conflated the steep descending front used for tracking with the height maximum used for water emission. Production nodes now preserve front coordinates, track the steep descending face, and independently walk backward to its first crest for emission. The shared phase advance from V94 remains. Unsupported faces stop emission after 0.12 s; already emitted water retains its trajectory. Initial production emission is horizontal, based on front speed; gravity subsequently changes vertical velocity. Legacy manually authored nodes retain their previous velocity behavior.

The 0.02 slope support threshold, search distances, and velocity gain are authored approximations, not site measurements. This is a kinematic wave-line model, not a mass-conserving fluid solver. Source amplitude, swell forcing and gravity were not reduced. The reference's adaptive line topology and center-outward emission region are not implemented here.

## Verification

144 focused tests pass (work/tests-v95.log), TypeScript noEmit and production build pass (work/build-v95.log). Tests cover front-versus-crest separation, disappearance of front support, and horizontal launch followed by gravity. Chrome reported no captured errors. Fixed-step captures are not realtime performance evidence.

- Final side view: work/v95-final-frames, 81 frames over 8 seconds.
- Final front view: work/v95-front-frames, 5 checkpoints over 8 seconds.
- Intermediate face/crest-only candidate: work/v95-face-frames; this is not the final code.
- GIF and MP4: outer outputs/breaking-waves-v95-candidate.

In the final side capture's last audit, 15 contacts had mean signed launch-to-contact height difference 0.2382 m and mean age 0.18 s. This bounded captured subset does not prove a convincing plunging breaker.

## Acceptance

Visual acceptance FAILS: thin floating sheet fragments remain, and the requested large crest curling and falling is insufficient. Experimental breakinglips remains opt-in; normal experience and the accepted standalone are not promoted to this candidate. Goal remains ACTIVE. Next work must address coupled shape and spatial emission topology, not hide faults by weakening waves or adding more opaque foam.
