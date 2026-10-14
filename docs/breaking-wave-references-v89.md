# V89 — match shell optical thickness to the actual pinched geometry

The connected mesh narrows its physical thickness by sin(pi*u) and by its along-front edge envelope, but passed a constant center thickness to absorption and refraction. Pass the actual local thickness instead. Wind, wave height, emitted positions, gravity, coverage and lifetime are unchanged. This corrects a dimensional inconsistency; it does not solve the remaining topology.

TypeScript, build and diff checks pass. Chrome rendered 8 temporal checkpoints at the same side-view parameters, with no console errors. Evidence: work/v89-edge-frames. Straight strips and insufficient overturning remain visible. The capture is not a deterministic pixel A/B and no quantitative visual improvement is claimed. V88 GIF/MP4 remain historical evidence, not V89 media. No standalone promotion. Goal ACTIVE.
