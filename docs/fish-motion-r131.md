# R131 fish continuity (CPU)

MarineLife retains each fish's last accepted position and heading. The original
ellipse, meander and depth oscillation remain its moving target. Only initial
placement may use the surveyed water centre; an obstructed swimming target never
resets a live fish to that centre.

Movement limits: horizontal speed 1.6 m/s, vertical speed 0.6 m/s and heading
change 1.8 rad/s. Every accepted move samples the actual interpolated 3D segment
at horizontal intervals of at most 0.02 m, including both endpoints. Samples must
be finite, below -0.65 m and retain the original size-dependent vertical seabed
clearance (size * 0.28 + 0.09 m). These are sampled terrain guarantees; arbitrary
sub-centimetre discontinuities between samples are not certified. A blocked fish
keeps a consistent turning side until it can swim, with 0.35 m lookahead during
avoidance. It returns continuously toward the analytical target when accessible.

Nonfinite times are ignored. Repeated/reversed times and jumps over 0.1 s rebase
the clock while retaining position and heading; the next ordinary frame resumes.
Missing terrain retains the last pose. Disposal remains idempotent.

`inspectFishMotion(limit=256)` returns bounded detached CPU poses for QA. It does
not expose mutable state or install a public/browser global.

Validation: five helper regressions plus actual MarineLife Vite SSR integration
(no HTTP listener or GPU), 255 authored fish, 40 simulated seconds, actual body
instance matrices, synthetic shoreline, detached inspection and disposal.
Deep-water control tracks within 0.12 m over 100 simulated seconds. Additional
controls cover nonfinite terrain, a ridge between valid endpoints, invalid
targets and time discontinuities. Evidence ceiling: LOCAL_PASS CPU only; visual,
GPU, real-coast and human acceptance remain root verification.
