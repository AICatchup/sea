# Forest ground R147

The candidate foreground contains metres-wide canopy leaves on the refined DEM terrain. Root ray evidence at (350,660) hits terrain at 2.36 m, with no native foliage hit. The causal source is coastCover(worldXZ * .18), rather than foliage LOD. Candidate/base and protected reference were inspected; protected pixels were never copied into assets.

makeTerrainMaterial(detail, atlas, sand, forestGround=false) keeps the complete V19 compiled vertex/fragment shader and cache key when false. True replaces only the existing green terrain domain with dry soil and fallen litter, using locally bundled unmodified Poly Haven Forest Floor diffuse/OpenGL normal/ARM JPEGs. No geometry, collision, vegetation alpha/gain, sand/rock masks, water contact or shoreline code changed. Legacy material remains the original path even with the flag.

Official API dimensions 2139.999628 mm become a 2.14 metre tile. Albedo is sRGB; normal and packed data remain linear. UV derivatives and all ground textureGrad samples execute outside divergent rock sampling branches. Ground roughness uses ARM green (clamped to a dry minimum .65), indirect AO uses red, normal uses the same signed world projection and derivative cotangent frame as sand. Ground albedo has no exposure gain or artificial foliage tint.

Ground loading is opt-in, joins material.userData.ready, reports failures while retaining authored brown soil (not canopy) fallback, and is material-owned for idempotent disposal. Caller sand/atlas/detail ownership is unchanged. 11 custom material samplers total; renderer environment/shadow allocation must fit the remaining minimum-WebGL budget and root owns GPU verification.

Provenance: https://polyhaven.com/a/forest_floor and https://polyhaven.com/license (official CC0 page checked 2026-10-02). The manifest records current official info, exact URLs, lengths, official MD5 and local SHA256. All three downloaded JPEGs match official MD5 and have no modifications. This generic autumn litter scan is a plausible ground material, not a Tomari species/season reconstruction.

Verification: tsc --noEmit PASS; targeted Node tests 2/2 PASS (V19 source-generated shader equality, true ground shader bindings, physical scan scale, SRGB/data separation, no synthetic CPU readiness, disposal ownership and byte hashes). No GPU/browser/photographic acceptance claim. Root wires the flag and performs A/B and final R146 review.
