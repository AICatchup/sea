# V96 — distinguish sheet emission from return to water

Base 4ad7d77. Inspection found that every material row was permanently absorbed whenever its descending parcel was within +2.5 cm of the sea, including the first step after horizontal emission. Unlike the tip state introduced in V91, sheet rows did not record separation. A parcel that had not yet cleared the contact band could disappear before ever being airborne.

Each material row now records whether it has cleared the 2.5 cm band. Return into that band absorbs only separated water; genuine submersion below -2.5 cm also retires it. Absorption remains irreversible. The extra bounded byte array has 59,160 entries and is reset on slot reuse. Wave forcing, height, velocities, and opacity are unchanged. No external source copied; existing wave-line references are in V95/V86. This is a local contact-state correction, not a new fluid solver.

145 focused tests pass, including an emission-band -> air -> contact -> receding-water regression. TypeScript and build pass. Side capture: work/v96-final-frames (81 frames, 8 simulation seconds). Front: work/v96-front-frames (5 checkpoints). GIF/MP4: outer outputs/breaking-waves-v96-candidate. Fixed-step evidence does not measure realtime performance.

Visual acceptance remains FAIL. Side rendering still contains thin detached fragments and does not establish large curling breakers. Do not present this contact correction as proof of visual improvement. Experimental flag stays opt-in, accepted standalone unchanged, goal ACTIVE. Next: inspect sheet connectivity across different source/receiving surfaces, together with spatial emission extent; do not mask it by weakening waves.
