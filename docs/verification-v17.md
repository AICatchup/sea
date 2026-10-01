# V17 dry rock-foot classification and refracted-ray experiment

The full Tomari/Niijima continuous FPS photographic objective remains ACTIVE and
UNMET. This implementation reuses completed one-pass R123 observations; there is
no repeated broad scouting. R133 owns the initial dry-foot CPU change in its
separate worktree; root owns subsequent corrections, rendering and publication.

Normal rendering now uses dry-foot height-field relief and classifies dry steep
rock consistently across the nested terrain patches. Broad sand smoothing had
also affected steep rock visible in the cliff photograph. Original interpolated
low/wet triangles remain unchanged, including the nested0.5m patch, original
raster joins and source anchors. Total added change is capped1.1m per patch; the
new low faces stay above1.1m. `toe=legacy` restores the preceding coherent field,
while the library's optional flag remains false. `rock=legacy` disables both.
The source terrain and actual renderer/controller share the same triangle sampler.
Vegetation and outcrop support are rebuilt from that terrain, so their transforms
can also change. Fixed four-view comparison is static terrain/derived vegetation
evidence, not an isolated displacement-only GPU comparison or travel proof.

An initial candidate changed low interpolated points by up to0.4811m despite
protecting low source vertices. The triangle-neighbour guard corrects that
failure. An early candidate also left the visible foot unchanged because the
sand mask and nested beach smoothing suppressed its relief; that is superseded
by the classified variant. Early `toe-candidate` PNGs are not final acceptance.

The root also measured an optical defect: a grazing air-side ray continued
straight underwater, giving1.3..11m of absorption path over shallow beds where
a Snell ray gave about0.5..1.1m. `ray=1` remains an EXPERIMENTAL comparison only,
disabled in the normal experience. It traces to visible scene depth with finite
bracketing/bisection, using unchanged absorption, light and tint. An earlier
height-field-only receiver created hard fallbacks around rocks; screen-depth
tracing includes visible objects but still stretches silhouettes and misses
hidden/offscreen surfaces. Those observed artifacts are why it is not adopted.
This is not full geometry ray tracing, surveyed water, natural-body physics or
photographic acceptance. Improving the receiver representation is the next
optical requirement; passing flat-interface maths does not solve it.

DEV fixed terrain captures align an actual camera and FFT clock34. They restore
the original clock, camera/settings; fish clock discontinuities hold retained
positions rather than reproducing identical histories. Optical original/on/
original captures use one frozen camera/time/history and record actual float
GPU path probes and RAF intervals. RAF timing is device-specific and not a GPU
timer query. Early height-field ray images are excluded from prototype acceptance.

Validation covers source low/strand/raster/crown anchors, bounded variation,
actual low triangle samples, a photographed steep-foot coordinate, negative
legacy flags, candidate strand collision and all authored boat corridors. Logs,
actual multiview images, a fresh one-pass reviewer and exact main readback are
preserved with the release. Existing continuous-voyage history does not prove
new native controls, every route, physical mobile or Human quality. Toe smoothing,
repeated ledges, sparse canopy, grey sea, static clouds, biology and full coast
shape still retain visible CG cues; tests and these images cannot complete goal.

## Retained results

Immutable `cd49cd6e6d9d63ba3d48f18922aaaf1b41de86dc` passed all240 tests,
TypeScript/Vite/embedded build and normal seven visual QA views. Four terrain
pairs use the same actual camera and FFTclock34; derived vegetation/rock support
changes are part of the world rebuild. Candidate coast changes3,395 vertices
by>.05m and remains capped1.1m. Root verified the steep picked coordinate
(-92.829,-26.415) changes by about.133m, with low interpolated points unchanged.

Actual same-controller QA input replay recorded116 observations from one initial
bookmark: walk→wade→swim→shallow dive, then walk again on a shoal. Maximum recorded
depth0.872744m; this is not deep-scuba, native keyboard/pointer or allroute proof.
The initial25-second attempt reached wading only and was not accepted as three
phases by itself. No intermediate teleport or mode-selection UI was used.

Optical prototype0/on/0 pairs returned original pixels exactly. Twenty-one actual
float GPU probes supported Snell direction with residual below about3.1e-6m;
that verifies the ray direction, not an accurate geometric receiver. Whole-scene
RAF medians around18ms are device-specific. R134 inspected actual images and
explicitly supported withholding normal ray adoption because of stretched rock/
buoy silhouettes. It supported modest dry-foot improvement and found no supported
new normal P1/P2 regression, while retaining full photograph-quality FAIL.

R133/R134 completed GPT-6.1 Sol low turns and exact parent edges were verified
with effective writable danger-full-access, separate from the requested ownership
restrictions. Final documentation-only changes do not alter the reviewed rendering.
