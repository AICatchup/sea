# Niijima continuous surface studies V55

Development-only experiments derived from the Tokyo Digital Service Bureau2023 island LiDAR data, **CC BY4.0**. Credit: 東京都デジタルツイン実現プロジェクト 島しょ地域点群データを加工して作成. No reference photograph or Google Maps pixels are included. These assets are excluded from the normal production bundle.

- `render.bin`: narrow study; source isV54 `source.bin`.293,213 vertices/574,909 triangles.4m quintic boundary deformation, no vertical contact curtains. Native footprint210,973 triangles; SHA256 `b0a47c3ecfb78972b469715f8e908339a1eec05e9cbc3f7f659fd15884e3f12f`.
- `source-expanded.bin`: source bounds x5785–5950/y0–165/z−1090–−940.550,987 ground/non-withheld observations,550,909 unique; Open3D0.19 Poisson depth9, crop only.321,237 vertices/640,452 triangles. SHA256 `20eb881dab71abb686e626436bdb782a0c3ee27f35813cae218d8c83b8d48691`.
- `render-expanded.bin`:310,388 vertices/606,336 triangles after projection clipping and4m boundary deformation.414,399 native triangles replaced; footprint SHA256 `71139261d3a047350a0b152003d390a58a7acd772c325129dfec57470382e417`. Render SHA256 `24739aa1267bb0a2855208e2910d49016f18d289048612ccf244eac79c2639c8`.

All buffers pack little-endian relative Float32 XYZ then Uint32 indices. Origin `[5880,0,-1015]`. Storage precision, numerical ray agreement and survey accuracy are different. Centimetre site accuracy is unproven.

The expanded source no longer crops the crest at85m: actual input reaches106.64m, below the165m cap. Native replacement is still deliberately limited to dry ground Y3–140 and Z−1088–−942. Maximum boundary Y deformation11.057m is **authored**, not measured geometry. Final floor uses the deformed mesh, with10µm nearest-point rescue inside the accepted native mask and an explicit2e-6m² coverage-area approximation. This is not watertightness or arbitrary under-overhang walking.

Independent8-view review chooses expanded as the best next prototype but rejects normal adoption: foot tears and material/shape gaps remain. A lower-layer burial experiment worsened the tears and was reverted. Reproduction uses `scripts/reconstruct-niijima-poisson-expanded.py` and `scripts/assemble-niijima-point-cliff.mts --study expanded`; neither installs assets automatically.
