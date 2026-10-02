# R144 connected cliff form (opt-in)

## Interface and unchanged reference

`structuralCoastHeight(x,z,y,base,sand,candidate=false,dryToe=false,connectedForm=false)`.
`cliffOutcrops(ground,bounds,candidate=false,connectedForm=false)`.
The new final flag overrides the old optional candidate only when true. False preserves the exact prior branch and buffer generation. Root owns raster-boundary blending and renderer/terrain flag propagation.

## Geometry

Actual protected reference and the three V19 views were inspected locally. The qualitative reference has broad connected angular rock, leaning clefts and unequal buttresses. V19 has round ramps with repeated disconnected plate rows. R144 changes the continuous height field through a piecewise planar anchored toe/scarp/crown profile and an unequal shared joint family. Joint coordinates drift obliquely with height; clefts recess into the field. The final height delta is bounded to -6/+4.2 m, faded at dry toe/crown/strand and gated to source slopes. This is inferred presentation geology, not measured photogrammetry or a reconstruction of the Google pixels.

The candidate outcrop geometry has no separate plate primitives. It uses a 2.4 m grid of shared indexed top vertices over already steep dry land, with an embedded back surface and closed boundary walls. Adjacent cells share vertices and edges. Regions separated by sand/gentle slopes/crown rejection remain separate shells. Minor top relief is 0.16–0.71 m vertically; the primary metre-scale buttress form comes from the structural height field. Collision AABBs include top/back for each cell; retain these in the collision binding. Render with the existing photographic rock material. `rockPieces=0` is deliberate; `connectedCells` and `triangleCount` describe the candidate.

## Anchors and limits

Source y<=1.1 m, seabed, high crown y>=62 m, low sandy strand and gentle source slopes remain exact in the structural function. The outcrop shell requires all corners y>=3.5 m, <=52 m and slope>=1.05; low sandy footprint and unsupported crowns are rejected. It samples only the existing bounds inset by 14 m. Root must preserve geographic source-boundary fade and test the actual vessel/body routes after integration. This worker does not claim photo/visual acceptance from CPU verification.

A source-field diagnostic (prior IslandElevation, no new renderer flags) emitted 821 cells, 5,868 triangles, 3,082 vertices; lowest exposed vertex 3.714 m. Maximum triangle budget is 80,000 with worst-case boundary reserve. Normals, winding, closed indexed edges, positive volume, synthetic swept-body hit and offshore/high-crown negative sweeps are covered. Height anchors and V19 default equality have controls.

## Verification

Targeted R144 plus existing hero-cliff tests: 10/10 pass, including actual source strand/vessel-height negative controls. Full regression suite before adding that final actual-source control: 267/267 pass (65.8 s). TypeScript noEmit: pass. Actual public A/B, integrated raster and route checks belong to root; no browser/server/provider actions were performed.
