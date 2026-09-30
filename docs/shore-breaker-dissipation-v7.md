# Optional depth-cap dissipation observable

2026-10-01. Additive GLSL export `shoreBreakerDissipationSampling` in `surface-detail.ts`. No existing displacement/phase/height formula changed; no runtime consumer is wired by this leaf.

## Caller contract

Include `${shoreWaveSampling}` followed by `${shoreBreakerDissipationSampling}`. Call `shoreBreakerDissipation(rawFftHeight, coast.rg, uSwell, uWind)` at the **same p** used by the current sampler after its existing choppy-coordinate inversion.

For root ShoreSpray specifically, rawFftHeight is:

```glsl
float rawFftHeight=texture2D(uLongWaves,p/384.0).y
                 +texture2D(uShortWaves,p/24.0).y;
float depthCapLoss=shoreBreakerDissipation(rawFftHeight,coast,uSwell,uWind);
```

Do not pass `displacement(p).y`, `longAt(p).y+shortAt(p).y`, or an already swell-scaled height. The existing ShoreSpray functions apply the shore scale to both cascades and then uSwell once to the sum. The helper applies uSwell exactly once and the same transport/wetFade/exposure once, with only the existing cap omitted. If another consumer fades its short cascade, its raw sum must include that same fade; the vertex shader's distant shortFade is not present in ShoreSpray's source.

## Meaning and equations

Let T be the existing transport, F its shoreline fade, G its clamped geographic exposure, raw crest r>0, and s=uSwell. Uncapped crest is `aU=r*s*T*F*G`. Capped crest is `aC=r*s*shoreWaveScale(coast,s,wind)`. Neither is nominal RMS amplitude. The existing cap retention is `C=clamp(aC/aU,0,1)`.

The fraction removed by the **existing modeled amplitude cap**, under energy proportional amplitude squared, is `Lcap=1-C²`. The physical depth criterion uses the explicit symmetric-wave proxy `Hproxy=2*aU` and fixed gamma=.73. If `Hproxy<=gamma*d`, return zero. Otherwise the excess-energy fraction above that depth envelope is `Lexcess=1-(gamma*d/Hproxy)²`. Output `min(Lcap,Lexcess)` bounds the observation by both energy the existing cap actually removed and energy beyond the depth proxy. It approaches zero continuously at onset and stays in [0,1]. This is a dimensionless fraction, not joules, a dissipation rate, particle emission count, or an overturning solution.

The helper cannot infer lost energy when the existing cap is inactive, even if a very large local crest exceeds gamma*d. It does not substitute the nominal amplitude estimate for the actual local raw crest. No foam noise, lower breaking gamma, wave-height gain or additional GPU readback is introduced.

## Bounds and controls

Domain is the existing surf-particle range d=.2..3.8 m. Exposure below .18 returns zero, matching the existing spray/whitewater protected-coast policy; this exposure cutoff is a renderer policy, **not a physical breaker parameter**. Tomari's protected core exposure is .13 in `shelterAt`; the open Niijima coast is 1. Land/deep/flat/negative crest return zero. Finite renderer bounds are s>0..4, wind=0..35, exposure=.18..1, raw r>0..<1e6. These exceed actual UI settings while rejecting NaN/infinities and malformed inputs. G affects aU before testing the depth criterion; it is not a second arbitrary multiplier of the output fraction.

## Evidence and limits

[SWAN's action/energy balance](https://swanmodel.sourceforge.io/online_doc/swantech/node12.html) supports amplitude-squared energy and distinguishes propagation from source/sink dissipation. [SWAN breaking settings](https://swanmodel.sourceforge.io/online_doc/swanuse/node28.html) define gamma=.73 as maximum **individual wave height** over depth. [SWAN's dissipation discussion](https://swanmodel.sourceforge.io/online_doc/swantech/node16.html) models dissipation separately. Our instantaneous `2*positivecrest` is a symmetric-wave height proxy; it is not measured crest-to-trough H and is unreliable for asymmetric nonlinear breakers. This helper observes a conservative subset of the existing cap's modeled energy loss; it is not a SWAN/Battjes-Janssen implementation or proof of physical breaking, CFD, a curling lip or overturning.

Root's current capped max H/depth estimate .369994, max crest 1.316 m, 185 eligible wet cells and zero positive J-energy do **not** prove this observable will fire. Actual uncapped raw crest remains unmeasured. Root must measure it and shader-compile/test the new export before deciding to encode max(existing J-energy, depthCapLoss) in the existing sample B channel. Geometry and all existing height consumers must remain unchanged.

## Verification

Four dedicated CPU tests pass: negative/flat/protected/land/deep and cap-inactive controls; independent amplitude-squared energy comparisons; continuous depth onset and monotonic raw crest response; exposure and swell bookkeeping plus nonfinite rejection. Four prior finite-depth diagnostic tests also pass; `tsc --noEmit` passes. Existing `shoreWaveSampling` and `capillarySampling` have no diff. No GPU claim is made before root's integration test.
