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

Six meshes/draws, 528 triangles. Four opaque support batches include the physical shallow drainage channel; joints and white paint are decorative batches. The road top is level +.02 m, sidewalk +.14 m, curb +.16 m, drain +.025 m. Largest neighboring step is .14 m. Own materials, geometry and procedural grain texture are disposed idempotently; no borrowed gate resources. Lines start beyond the gate footprint and the center axis is unpainted. CPU tests cover finite vertices, bounds, coordinate transform, support height, resource ownership and disposal. No GPU/browser/server or downloaded resources were used.
