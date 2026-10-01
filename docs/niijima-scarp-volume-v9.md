# Niijima scarp volume v9

Authored geological hypothesis; raster elevations and shoreline arrays are unchanged. Google reference was viewed for geometry interpretation only, with no pixel redistribution.

The closed solid extends z -1080 to -500, with 80m terminal feathering and terminal rings buried beneath actual support. A weighted shore-station curve carries a fixed parallel-transport inland frame in a ruled/sheared parameterization: all vertices in one station share z. This deliberately avoids intersecting independently estimated coast normals. Face/roof share the exact endpoint. Upper face offsets are locally monotone to prevent a roof crossing an eroded lip.

45 unevenly placed fissures follow continuous asymmetric paths through height; triangular incision profiles, narrow angular bedding lips, and faceted talus replace broad rounded shelves. Detail and dimensions remain author hypotheses.

Measured: one mesh/draw, 44,513 vertices, 89,022 triangles, source shore toe minimum 33.619m; bounds x 5527.754..5866.791, y -4.276..122.646, z -1080..-500. Positive signed volume 2,277,297m3; minimum triangle double area 0.03045m2. All indexed edges occur twice and Euler characteristic is 2.

Validation: four tests PASS; finite attributes, positive volume, manifold connectivity, strict intersection checks for every nonadjacent segment in each of 401 rings, disjoint station planes, terminal burial, unchanged source heights, invariant 12m corridor, and dry-strand radius 0.45m sampled vertical clearance at distances 4/8/12m every 3m. TypeScript PASS. These checks do not establish arbitrary triangle-triangle nonintersection between adjacent interpolated rings, capsule sweep ground traversability, visual seam quality, or photoreal acceptance. Root must integrate and render close/forward/reverse views with fresh visual review.
