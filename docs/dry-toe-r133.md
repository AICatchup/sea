# R133 dry-foot height-field candidate

Status: LOCAL_PASS only. GPU A/B, multiview movement/collision acceptance and a fresh independent review remain root-owned. Photo-level continuous Tomari/Niijima goal remains UNMET.

Context inspected: existing coherent source plus root `work/sea-v16-final/{cliff,spawn,lookout,shore}.png` and `work/tomari-reference/google-tomari-main.jpg`. The visible rounded foot motivated limited connected concave relief, not new scattered blocks or beach roughening. This is authored presentation detail, not geological survey evidence.

`new IslandElevation(true, true)` / `new IslandWorld(true, true)` enables the candidate. Final optional `dryToe` argument defaults false; coherentRock=false keeps legacy behavior regardless of dryToe. `structuralCoastHeight` accepts dryToe as seventh argument. Root owns renderer query and adoption decision.

The new delta shares upper-face oblique joint coordinate u, adds narrow cosine grooves and two irregular band waves. It only applies through the existing steep-source/local-slope and nonsandy masks. Height envelope rises 1.1–2.8 m, remains strongest to 7 m, fades to zero by 10 m. Max added inward relief is 1.1 m; positive shelf relief <=0.35 m. Joint nominal spacing 7.3 m; groove coefficient .95 m; shelf coefficients .22/.13 m. Useful tuning range for root: groove .65–1.0 m, band amplitudes .1–.25 m, envelope end 8–10 m. Do not increase amplitude before checking actual cliff normals and traversal.

The existing raster-boundary join and beach blending remain; this changes the ground array consumed by both rendered triangles and height collision. No independent geometry, crown/shoreline/seabed or DEM changes. Analytic new delta is continuous; pre-existing upper panel relief is unchanged.

CPU: dedicated dry-toe + terrain checks 14/14 pass; TypeScript noEmit pass. Actual coast raster: 2,823 vertices differ by >0.05 m, maximum additional difference 1.1000003814697266 m (Float32 rounding). Checks cover low/sand/crown/gentle anchors, bounded finite continuous low-face samples, actual raster impact and joins. These measures establish a meaningful local change, not image quality or runtime acceptance. No server, browser, GPU, installation or publication performed. npx wrapper was unavailable in bundled runtime; direct `node node_modules/typescript/bin/tsc --noEmit` succeeded.
