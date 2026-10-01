# V18 geometry receiver and continuous hand anatomy

Full photographic Tomari/Niijima/FPS objective remains ACTIVE and UNMET.
This slice reuses closed broad observations; R135 builds triangle receiver data,
R136 builds hand anatomy in separate worktrees, root owns integration/GPU/publication.

Normal first-person body keeps the original47 bones, seven material draws and
controller collision boundary. Smooth finger profiles/pads/creases replace abrupt
ring sections; skin has restrained colour variation and lower wet clearcoat.
Triangles36,700 versus25,820. This is original procedural anatomy, not a scan,
photographic skin, likeness or complete human-quality acceptance. Paired studio
inspection copies the entire transform graph, not just bones: missing rig-group
rotation initially mirrored the old comparison and those images are excluded.

Geometry refraction is experimental and NORMAL OFF. It packs actual opaque mesh
BLAS, visible-instance TLAS, original UV/colours/material IDs and real transforms.
The separate barycentric seabed is traced independent of camera depth. Dynamic
instances refit small tables; static triangle data stays fixed. Opaque regular
meshes below4m are included; DEM/foliage/shader/skinned/morph/alpha surfaces are
excluded. In particular, the first-person skinned body is not a traced receiver;
own-body wading images require further checking before normal adoption. No full
scene/skin/hidden-material or global physical correctness is claimed.

Root combines static and dynamic tables into two float texture samplers and a
512px sRGB diffuse array. Original UV transforms, wrap, base/vertex colour and
material IDs are retained. Receiver shading currently uses macro geometry,
diffuse photos, scalar roughness/metal, sun GGX, shadow, spectral sunlight and the
existing photon field; normal/ARM maps and full IBL/material parity remain gaps.
There is no arbitrary water-tint gain. Hidden/offscreen opaque receivers no longer
depend on screen-depth intersection, but overall optical/photographic quality
requires actual image acceptance. Device texture size/layer limits are checked.

Initial inclusion of unsupported changing alpha geometry rebuilt341,180 triangles
and the atlas every frame (about3120ms RAF median). Root's opaque predicate fixes
that: actual fixed-camera comparison retains one rebuild through65 refits, with
about18ms median in this one environment. This is wall timing, not GPU timer or
portable performance proof. CPU/GLSL layouts, overflow unavailable behavior and
borrowed resource ownership remain tested. Four actual triangle GPU targets match
independent CPU intersections within about1.5e-6m; normals/UV/material IDs also
match within recorded float tolerances. Four selected rays are not scene-wide proof.

Saved checkpoints include initial failed-performance images, fixed0/on/0 images,
actual GPU/CPU ray records and aligned old/new dorsal/palm dry/wet inspection.
Early incomplete pose comparisons are excluded; original source snapshot is
`cce15ff`, included only in DEV comparison through a dynamically eliminated import.
Further wading/underwater/helm visuals, independent review, final checks and exact
main readback remain necessary before publishing this integrated slice.

The normal logo already calls recenterLook, preserving position; the initial
root statement that it teleported was incorrect. Its runtime position should be
checked rather than removing a harmless look action based on stale notes.

Disk exhaustion interrupted PNG writes. Root compressed existing task HTML and
archival task GLBs in place without deletion. Six stored release HTML hashes were
checked unchanged; free space recovered to about0.9GB. Old releases/dirty work
remain preserved. This storage recovery does not imply game-quality acceptance.
