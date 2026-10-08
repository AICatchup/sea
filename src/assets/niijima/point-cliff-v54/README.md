# Niijima point-cliff reconstruction study V54

Derived from the Tokyo Metropolitan Government Digital Service Bureau's [2023 island LiDAR dataset](https://www.geospatial.jp/ckan/dataset/tokyopc-shima-2023), original LAS tile09QC1711. Data and derived geometry: **CC BY4.0**. Credit: 東京都デジタルツイン実現プロジェクト 島しょ地域点群データを加工して作成.

This is an **unadmitted development experiment**, excluded from the normal production bundle. It is not a local photogrammetric texture, centimetre-accurate survey, closed solid, or complete coastline. No Google Maps or reference photograph pixels are included.

- `source.bin`:291,349 vertices/580,589 triangles; relative Float32 XYZ then Uint32 indices; origin `[5880,0,-1015]`. Open3D0.19 Poisson depth9, class2 ground/non-withheld220,015 observations,219,988 unique. Cropped only; no density trimming.
- `render.bin`:551,358 vertices/799,066 triangles after clipping to102,818 native triangle halves and merging at1e-7m tolerance. The collider omits82 triangles at its existing1e-10m² area cutoff.
- Source SHA256:`563483a3474de29bb445e338ba8d468b1ea2f377f1e860f082e91029e00d9a19`.
- Render SHA256:`7412c785684b004eaa1bf4d0ed9ecb67a6d63b9e97acb7344685ea470c9efcda`.
- Ordered native footprint SHA256:`f55b2375218d869b2d71cfbbd9bffdf8bb00796b46d703e33f1f0d2a16cd1449`.

The runtime constructs inferred contact curtains along the footprint boundary. The maximum native/reconstructed height difference is30.896m. Those curtains prevent large open seams but look artificial; independent visual review rejects normal adoption. Highest-plane floor queries cannot model arbitrary walking beneath overhangs. Float32 clipping also creates minute boundary gaps; watertightness is not established.

Reconstruction: `scripts/reconstruct-niijima-poisson.py` from the existing original ZIP. Fixed asset assembly replay: `scripts/assemble-niijima-point-cliff.mts`. Neither automatically modifies game assets. See `docs/research/sea-point-cliff-v54.md` and `docs/verification-v54.md` for evidence and limits.
