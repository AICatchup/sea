# Habushi ordinary-controller contact regression

Base: `7b22e73515565054031d32212c9950d5dba06b70`. CPU fixture constructs actual `IslandElevation` / `NiijimaCoast`, derives `HabushiMainGate` from that DEM, applies gate grading, constructs `HabushiGround`, applies its grading, then registers both opaque solid groups with `WorldCollision`. `withWorldCollision` supplies the same ground and solid queries used by the controller adapter. No flat replacement ground, mesh proxies, altered controller state, jump assistance or frame-by-frame teleports are used. Each independent scenario has a single initial QA `viewpoint`; subsequent movement uses `setMove` and `update` only.

Local coordinates are gate-relative metres (+z roadfront, X along the coast). Both 30 and 60 fps are tested. Directional waypoint feedback stops within .16m to avoid fixed-duration overshoot. Each leg has a distance-derived finite deadline. Every frame checks finite coordinates, bounded displacement and actual support height whenever grounded. Stair scenarios require all 20 distinct tread heights, upper-landing elevation and grounded walking after descent.

Results: 8 passing and 8 failing cases across 16 independent checks. Production sources were not changed. These are intentionally failing regression tests for the root integrator to fix, rather than expected-failure tests that would conceal the defect.

Passing at both frame rates:

- Both road ends: local (0,22) → (±31,22) → (0,22). The road mesh ends at X ±30, so these checks include the mesh-to-graded-terrain edge and return.
- Both stair flights from sidewalk QA starts: (±9,10.5) → (±9,-.8) → (±9,10.5). All 20 tread heights and upper landing are reached with ordinary input, and descent finishes grounded.

Defect 1: road-to-sidewalk entry fails identically at both rates, on left/right stair approaches and central portal approach. Starting local (±9,22) or (0,22), the controller stops at z12.2131 with local feet height .1432, local eye height 1.7832, `grounded=false`, `speed=0`. Holding forward does not progress. At 30 fps, the final trace from t14.73 to14.90 is unchanged; at60fps, t14.82 to14.90 is unchanged. Curbstone is top .16, road top .02. This is consistent with a rounded capsule edge contact pushing the body upward before the vertical support/grounded query resolves the curb; that explanation is a hypothesis, not a verified root cause.

Defect 2: independently starting on the central sidewalk (0,10.5), aiming through the opening toward (0,-5), displaces the traveller laterally to x≈-3.3 and stops at z≈4.192 despite the target staying on x0. At30fps t16.97..17.13: x-3.3212..-3.3087, foot0, groundedtrue, speed0. At60fps t17.03..17.12: x oscillates approximately -3.30..-3.22, foot0, groundedtrue, speed0..15cm/s. This occurs before reaching the portal back side. A combined-solid containment/resolve interaction is a candidate cause; no source modification or diagnostic conclusion has been made.

Validation commands use absolute Node runtime:

```powershell
& 'C:/Users/rambo/AppData/Local/OpenAI/Codex/runtimes/cua_node/be2aaea167c12e53/bin/node.exe' --experimental-strip-types --test tests/habushi-continuity.test.ts
& 'C:/Users/rambo/AppData/Local/OpenAI/Codex/runtimes/cua_node/be2aaea167c12e53/bin/node.exe' node_modules/typescript/bin/tsc --noEmit
```

The initial 14-case run completed in35.1s with8PASS/6FAIL. Added independent central-sidewalk portal tests and extended road endpoints were checked with `--test-name-pattern='road end|portal from sidewalk'`:4PASS/2FAIL. TypeScript source check passed. Runtime/GPU/photo acceptance remains outside this CPU evidence.

## Root repair, 2026-10-01

The previously committed failing traces remain the baseline. The root collision repair adds the closest point of each actual upward triangle projected inside the foot disk, so diagonal narrow curbs cannot fall between the five support rays. It also replaces deduplicated unoriented ray parity with oriented shell crossings checked in two directions. Coincident entry/exit faces of merged closed stair volumes must cancel; the old parity could treat empty portal space as interior.

The actual DEM/controller matrix now passes all 16 cases at 30/60 fps, including every tread, upper landing, return, curb, portal and road endpoints. Combined with the existing solid registry suite, 32/32 focused cases passed. This is CPU controller replay evidence. Native human keyboard traversal, browser appearance and surveyed dimensions are separate and remain unproven.
