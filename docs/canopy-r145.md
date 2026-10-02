# R145 canopy continuity candidate

Opt-in `new AssetWorld(ground, {canopyContinuity:true})`. Default/false preserves every V19 placement matrix and LOD threshold. No texture, material, geometry, tree-root/collision, density, or resource-owner changes.

Diagnostic: V19 low shrub transforms use horizontal 2.85–3.35 but vertical .27–.39. The native leaf stratum is flattened against soil; the 35-degree capped lean leaves residual burial on steeper support. Reference crest cover is irregular but has visible thickness; V19 GPU images show scrappy skyline chips.

Candidate retains identical seeded pockets, variants, yaw, plant counts and tree matrices. Low understory uses horizontal 2.2–2.4, vertical .6075–.8775, still following the capped support normal. Four 1.2m support samples provide an upward residual correction capped at .35m. Existing height/slope/spawn exclusions remain exact. Mid shrub reach extends 110m to 210m; exclusive angular priority, 48 near / 180 mid caps, 1.35M shrub / 3.6M pine triangle budgets are unchanged. No new meshes or draw bands.

Validation: targeted fixture has 564 trees / 1,771 shrubs (776 restored low shrubs); exact default matrices, unchanged tree collisions/roots and shrub x/z, finite transforms, .35m support bound, spawn exclusion, exclusive LOD across three viewpoints, caps and group disposal pass. Fixture proxy draw/triangle sample: pine 16 / 108,288, shrub 12 / 106,260. These are CPU proxy measurements, not native GPU evidence. TypeScript passes. Full native-source GPU A/B, real-terrain support and total renderer caps remain root integration checks; no photoPASS.
