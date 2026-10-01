# R136 body anatomy implementation

The existing original skeletal body remains render-only. Public API, 47 bone names/hierarchy, action blending, camera coupling, collision capsule and seven material groups are unchanged.

The eight non-thumb fingers now sample continuous eased nonuniform profiles at three longitudinal samples per original interval and 24 circumference segments. Joint widths are reduced to avoid circumferential bead silhouettes. Broad dorsal knuckle pads, narrow volar flexion folds and fingertip pulp now use continuous anatomical distance fields rather than ring-index steps. Bone contributions are interpolated and the strongest two normalized influences retained; there is no attachment or pose timing change. Nails retain their existing distal-bone anchoring. Palm tendons now fade across the dorsal shell rather than abruptly appearing at a threshold angle.

Skin adds an owned, low-contrast periodic colour map separate from metric pore normals and roughness. Wet clearcoat is reduced to preserve broad rough highlights. All maps are locally generated procedural assets; they are neither photographed skin nor scanned anatomy.

CPU validation: TypeScript no-emit passes; two dedicated Node tests pass. Tests inspect every rest vertex/normal/weight and every rest triangle for finite/normalized/nondegenerate geometry, then evaluate sampled skinned vertices across seven actions and 36 phases per action. Skin resource distinctness and dry/wet highlight bounds are checked. Geometry is 36,700 triangles versus 25,820 at base (1.42x), seven material groups and 47 bones.

Evidence ceiling: LOCAL_PASS only. CPU checks do not establish attractive all-angle anatomy, nail-to-skin contact during extreme curling, viewport clipping, or photographic realism. Root must inspect actual dry/wet look-down, swim/dive and helm GPU views. Original thumb/palm topology is preserved; intersecting connected shells are not claimed to be a watertight single manifold. Full visual goal remains unmet pending that inspection.
