# Habushi roadfront pavement

The authored module follows the gate's geographic center, rotation and grading level. Local +z faces west toward the road; local X runs along the coast. Reference inspected: local `gate-reference/front.jpg` and the fixed 1280 day native-canvas `habushi-front.png`. The photo shows a narrow sidewalk, edge/drain, pavement joints, a side crossing and foreground parking paint. The existing render had a broad pale floor without these boundaries.

Absolute dimensions are **unmeasured**: 60 m along the coast, sidewalk local z 9.3–11.8, road/foreground parking local z 12–35. Crossing placement and parking spacing are inferred from one photograph, not surveyed. Material colors are authored neutral daylight starting points; actual renderer illumination and runtime photographic acceptance remain unverified.

Root integration:

```ts
const pavement = new HabushiGround(gate);
coast.applyGrading(pavement.grading); // apply same level to mesh, sampler and water map
scene.add(pavement.group);
pavement.group.updateMatrixWorld(true);
pavement.solidsGroup.traverse(o => { if (o instanceof THREE.Mesh) collision.addMesh(o); });
// In shutdown, before losing owned references:
pavement.dispose();
```

Apply both gate and pavement gradings at the same gate-derived level. Pavement grading center is local z 22, halfWidth 30, halfDepth 13, feather 5. It must precede collision/terrain use; overlaying this mesh alone does not flatten the DEM. No gate, terrain, renderer, controller or shared material file is changed.

Six meshes/draws, bounded below 5,000 triangles. The road support now has a 2 m vertex grid for smooth bounded wear: a darker drain edge and slightly paler exposed parking apron. Existing fine aggregate bump repeats every .6 m in object space rather than once per box UV. Paint stays a separate opaque off-white finish; no image assets were added. Four opaque support batches include the physical shallow drainage channel; joints and white paint are decorative batches. The road top is level +.02 m, sidewalk +.14 m, curb +.16 m, drain +.025 m. Largest neighboring step is .14 m. Own materials, geometry and procedural grain texture are disposed idempotently; no borrowed gate resources. Lines start beyond the gate footprint and the center axis is unpainted. CPU tests cover finite vertices, bounds, coordinate transform, support height, resource ownership and disposal. No GPU/browser/server or downloaded resources were used.


2026-10-01 look pass: inspected local front and oblique photos and the fixed before render. The photos show differing asphalt exposure and fine tiled stairs; apron wear colour is authored, not an exact measured weather map. Gate rails use a bronze/gold starting colour; upper landing and bridge finish use blue tile informed by root inspection of DRONE47 at 0:20. Tile seams are .5 m authored spacing and all absolute dimensions remain unmeasured. Tower-top cavities were not changed because visible dark areas do not establish a measured section. Native GPU acceptance remains the root integration gate.
