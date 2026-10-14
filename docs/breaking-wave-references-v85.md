# V85 — measured impact fall, not remote trough depth

Base 3a1ff47. A bounded 128-contact audit found a concrete mismatch: in the final 128 contacts of an 8-second run, 115 contacted by 0.15 s. Mean actual launch-to-contact fall was 0.02161 m, but mean assigned drop was 1.65341 m. The renderer inflated whitewater using a distant trough drop even when the tip barely left the crest. Raw metadata: work/v85-flight-audit.json; reduced statistics: work/v85-flight-summary.json.

Impact events now pass actual nonnegative launch-to-contact fall and relative travelled reach to the whitewater pool. Wave spectrum, swell, crest height and gravitational trajectories are unchanged. A regression test checks that a 3.5 m distant drop cannot create a large impact bloom on a level receiving surface. Bounded flightAudit is exposed in existing QA diagnostics.

A crest identity experiment did NOT help (74 events baseline vs 76 after attempted tracking); it was removed, with rejected diff saved only in work/v85-identity-rejected.patch. Do not report it as an improvement. Previous external references remain in V81-V83; no new external source code was copied.

131 focused tests, TypeScript and build passed. Front 81 frames and side 8 checkpoints are fixed-step rendering, not realtime FPS evidence. Candidate media in outer outputs/breaking-waves-v85-candidate. Normal experience and official standalone remain unchanged; breakinglips stays experimental.

Visual acceptance still FAILS: oversized foam is reduced, but a convincing large overturning wave is missing and thin surface seams remain. This fixes false impact energy, not the complete wave. The audit changes the next action: launch from the nearly flat crest top with constant upward speed 0.4 m/s returns to its source within ~0.13 s. Source trajectory/steep face coupling must be corrected before tuning foam. Do not solve this by ignoring contact, arbitrarily delaying landing, or declaring the quieter result complete.
