# Clean Asphalt — photographic pavement material

Original Poly Haven **Clean Asphalt** by **Dimitrios Savva**, CC0-1.0. The source page and API specify a 2.1 × 2.1 metre scan span. Diffuse, OpenGL normal and ARM are the unchanged 2048 × 2048 JPG files. Original MD5, SHA-256, byte sizes and URLs are in `manifest.json`. Rebuild with `node scripts/fetch-pavement.mjs`; changed original bytes are rejected.

The diffuse map is sRGB; normal and ARM are linear data. Existing 0.6m pavement UV units use repeat 0.6 / 2.1, with the same offset for all channels. The material is non-metallic; ARM red supplies AO and green supplies roughness. No geometric displacement is applied, so road support and the kerb height remain unchanged.

This is a generic photographed asphalt surface, not imagery of the Habushi forecourt. The brighter weathered palette, metre-scale wear and joint treatment are authored. The initial Worn Asphalt candidate was rejected because its extensive leaf litter did not match the reference road.

Source: https://polyhaven.com/a/clean_asphalt

License: https://polyhaven.com/license
