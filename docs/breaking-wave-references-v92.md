# V92 — project resampled emission nodes onto their source surface

Base 6dbac0d. Front resampling interpolated heights between sparse crest nodes, placing intermediate nodes below a convex water surface. Production emitFront now resamples the actual height/depth and initial vertical velocity at each final x/z before committing a slot. Invalid source geometry is rejected before allocation. The new curved-source test verifies all 17 nodes begin on the surface. Existing low-level callers without a sampler retain their explicit initial conditions.

Added a bounded 128-entry central-node source audit: launch height, receiving surface, initial vertical speed, horizontal speed, first-step clearance and assigned drop. This is diagnostic evidence, not a fluid solver. The initial audit was inspected through Chrome before reload; final audit is saved in work/v92-source-frames/runtime.json.

139 focused tests, TypeScript, build and diff checks pass. Final Chrome temporal checkpoints at 0/2/4/6/8 seconds saved in work/v92-source-frames, errors empty. Final source audit: 72 sources, 63 negative initial vertical velocities, 63 below water after the first step, initial up range -8 to 2.814 m/s; 69 recorded impacts. This proves that source interpolation was not the sole cause. Next inspect the gradient/rate used for kinematic initial velocity: current gradient is a stencil at floor(cell), while height is bilinear at the actual location. No arbitrary upward impulse should be substituted for resolving that mismatch.

Visual acceptance FAILS: weak overturning and disconnected fragments remain. Wind/swell unchanged; no default or standalone promotion. V91 media remains historical, not V92 evidence. Goal ACTIVE.
