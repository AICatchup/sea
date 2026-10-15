# V101: connected breaker normal consistency

The experimental connected breaker shader now derives its shading normal from the same root-attached surface used for vertex placement. Previously only the center position received the sea-surface attachment correction, while neighboring samples used the uncorrected ballistic sheet. Removed an additional tiny vertex ripple applied after normal calculation. Wave forcing, height and parcel gravity are unchanged.

Validation: 145 focused tests pass; TypeScript check and Vite build pass. Actual visual acceptance remains pending: the local server had stopped and was restarted, but browser automation remained paused during document resolution. No new GIF/MP4 or photorealism claim is made. The experimental breakinglips flag remains opt-in. Floating pieces and full plunging-breaker continuity are still open acceptance items.
