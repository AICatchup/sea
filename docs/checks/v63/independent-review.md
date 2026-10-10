# V63 independent review

Read-only review, 2026-10-10. Supplied eba66da was not accepted unchanged: pending shadow updates lost hidden casters, world matrices were stale, clipBias retained vertices farther than 5cm beyond y=0, and prepared Standard materials bend down with distance. Reproduced using installed Three Reflector and source inspection.

Corrected implementation: no concrete current-scene blocker found. Real reflection projection is extracted after matrix refresh; shadow-update frames remain unchanged. Earth-only material certificate invalidates on hook replacement. Unknown vertex deformation, children, skins and morphs stay drawn. Geometry/position/instance/count changes invalidate bounds. Visibility and scene callback restore on exceptions.

Reviewer reran 6 regression tests, all pass, plus four read-only scenarios: position attribute replacement, interleaved position update, modified material exclusion, previous scene hook throwing. No browser actions or writes by reviewer.

Reviewer required the accepted ON PNG to have skippedMeshes > 0 in its final reflection. Root verified 33/82/33 for the three views and measured image equality independently. Acceptance covers this scoped optimization only; no full journey, photorealism or FPS acceptance.
