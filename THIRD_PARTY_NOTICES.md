# Third-party notices

Rendering uses [Three.js](https://github.com/mrdoob/three.js), under the MIT license. Its license is included with the dependency and standalone output.

UI font subsets are [Noto Sans JP](https://github.com/google/fonts/tree/main/ofl/notosansjp) and [Outfit](https://github.com/google/fonts/tree/main/ofl/outfit), under SIL OFL 1.1. Unmodified licenses are in public/fonts/ and embedded in the standalone HTML.

The wave spectra, FFT shaders, atmospheric/water extensions, interface, procedural geometry, and synthesized surf are authored code. No recorded audio is used.

The GSI land-elevation snapshot is derived from the Geospatial Information Authority of Japan's elevation tiles. Source URLs/hashes are in src/world/geodata.generated.ts. See [GSI elevation tiles](https://maps.gsi.go.jp/development/demtile.html) and [GSI content use](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html). Coast refinement and bathymetry are authored, not additional surveys. 国土地理院の標高タイルを加工して作成しました。

Poly Haven photo-scanned rocks (boulder_01, namaqualand_boulder_02, namaqualand_boulder_03, coast_rocks_01, coast_rocks_03), Sand 02 by Charlotte Baglioni, and Kloofendal 48d Partly Cloudy Pure Sky HDR by Greg Zaal / Jarod Guest are [CC0 1.0](https://polyhaven.com/license). Original PBR maps/HDR and provenance are under src/assets/marine/, src/assets/sand/, src/assets/sky/. Current rock geometry is reduced while preserving UV chart boundaries; V34 geometry-only sidecars reuse the original maps. The legacy GLBs remain pinned inputs for V32 cliff reproduction. Placement, seabed conformance, inferred sediment burial, proportions and lighting are authored. These were photographed elsewhere and are not Shikinejima survey evidence.

Coast and foliage atlases are AI-generated authored assets. Google Maps and Shikinejima tourism photographs were viewed as references only; source images are not redistributed. Standalone output includes asset source notices and licenses.

The fractured cliff material is Poly Haven **Rock Face 03**, by Dario Barresi (photography) and Rico Cilliers (processing), under CC0-1.0. Unchanged photographs and map hashes are in src/assets/coast/. Color calibration, stochastic world projection and wetness are authored; this is not a Tomari geological survey.

Coastal canopy models and native leaf masks **island_tree_01, island_tree_02, island_tree_03**, and the earlier **pine_sapling_small, shrub_02, shrub_03** resources, are Poly Haven CC0-1.0 assets. Original and derived geometry/map provenance is in src/assets/foliage/cc0/. These are generic coastal evergreen models, not a surveyed inventory or exact species identification of Tomari plants.

The expanded Niijima surface is processed from GSI DEM5A/DEM10B tiles, with source hashes in src/world/niijima-detail.generated.ts and src/world/niijima-north.generated.ts. Beach microrelief, seabed, building foundation grading and small rock placements are authored refinements.

Habushi Main Gate and the avatar are authored 3D geometry. The gate uses the official Niijima tourist gallery as a visual reference only; no gallery pixels are included. Absolute gate dimensions and unobserved faces are inferred. Boat upholstery uses authored geometry and procedural cloth maps, with no photographic fabric redistribution. See docs/habushi-main-gate-provenance.md.

The generic gate finish **White Plaster 02** by Rob Tuytel and pavement **Clean Asphalt** by Dimitrios Savva are Poly Haven CC0-1.0 assets. Original maps, source hashes and attribution are under src/assets/plaster/ and src/assets/pavement/. The brightness calibration and weathering are authored; neither material was photographed at Habushi Main Gate.

Niijima cliff microdetail also uses unchanged 2K **Rock Face 03** maps by Dario Barresi / Rico Cilliers, CC0-1.0. Hashes and attribution are in `src/assets/niijima/rock-face-03/`. The white-pumice palette, layered shader, closed erosion mesh and its placement are authored; the scan was not acquired in Niijima. The V40 coastline source seam correction preserves original GSI bytes and records the exact affected coarse-only cells in `niijima-coast-confidence.generated.ts`. New seabed depths remain inferred.

The V41 native Niijima ground patch is processed from Tokyo Metropolitan Government, Digital Services Bureau, **東京都デジタルツイン実現プロジェクト 島しょ地域点群データ**, catalogue https://www.geospatial.jp/ckan/dataset/tokyopc-shima-2023, CC BY4.0 (https://creativecommons.org/licenses/by/4.0/). Coordinate registration, centimetre storage quantization, outer-boundary blending and runtime triangulation are modifications by this project. Source09QC1711 native25cm GeoTIFF is pinned by hashes. See docs/niijima-native-survey.md for provenance, terms and accuracy limits; the derivative is not endorsed by Tokyo and does not establish physical centimetre accuracy.
