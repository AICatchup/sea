# V84 — irreversible receiving-water contact

Base a38b21f. The separated sheet now retains per-row contact state. When downward-moving water reaches the receiving surface, that material row stays absorbed even if sea level subsequently falls. Younger water remains in flight. This avoids resurrection of already landed water; it does not increase or decrease wave forcing.

Rows are indexed persistently only after emission stops. The bounded byte array resets when a front slot is reused. Rendering attenuates absorbed samples using the existing envelope, leaving parcel positions unchanged. This is a one-way contact model, not mass-conserving transfer. No new external code was copied; external references remain in V81-V83.

130 focused tests pass, including a receding-water regression test that keeps younger water airborne while checking already absorbed rows. TypeScript and production build pass. Chrome side checkpoints show remaining hard whitewater lobes and long surface seams: visual goal NOT achieved. Experimental breakinglips stays opt-in; V83 density rendering remains separately opt-in. Official standalone unchanged.

Next: source-to-base coupling and repeated whitewater lobe construction still need replacement/refinement. Contact state improves causality but cannot supply missing overturning or realistic aerated water by itself. Fixed-step captures do not prove realtime performance.
