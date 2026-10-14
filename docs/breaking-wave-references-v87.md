# V87 — fixed material rows across a breaking front

Base 606be67. Previously row time was rescaled from zero to each column's separate emission end. Thus the same row could refer to different release times across the front, and to different water as age advanced. It now refers to a fixed 1/60-second emission timestamp, shared by all columns. There are 145 bounded rows over the existing 2.4-second lifetime. The geometry samples the current portion using a per-instance clock; future/unemitted rows cannot be displayed. Absorption now refers to a stable parcel identity even while a source feeds.

Coverage is bilinearly interpolated separately from the cubic position/velocity interpolation. High fall speed in a neighbour can no longer make an absorbed sample visible through overshoot of the signed velocity channel.

133 focused tests pass, including a new check that the same emitted row continues its gravitational trajectory while later water is emitted. Existing overlap and post-separation tests were updated to select the intended physical rows in the new layout. TypeScript/build pass. Buffer growth is bounded (145 vs 33 rows); realtime performance is not yet established. Wave forcing and amplitude unchanged. Existing external references are in V81/V86; no external source copied this turn.

Final side81 frames: work/v87-final-frames; final front8 checkpoints: work/v87-front-frames. Fixed-step capture, not realtime FPS. Candidate GIF/MP4: outer outputs/breaking-waves-v87-candidate. The earlier rows87 capture was cleared by source reload and is NOT validation of final code.

Visual acceptance FAILS: disconnected narrow ribbons, angular intersections and weak large-scale overturning remain. Correct material identity is necessary but not sufficient for the requested sea. No accepted standalone promotion; breakinglips stays experimental. Goal ACTIVE.
