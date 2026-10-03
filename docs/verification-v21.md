# V21: native foliage detail and connected local movement

Rendered/reviewed source: `274fef0f65e7f5964bce431f72fb7530412ed744`. The subsequent publication commit changes documentation only. Overall photorealism and full island journey acceptance remain **UNMET**, and the Goal remains active.

## Actual correction

The initial near/mid/far foliage arrays shared the same mutable slots. Loading the far mesh consequently overwrote the near and mid selections. Independent arrays now preserve each native source band. Normal experience also uses view-aware allocation, retaining nearby shadow casters and all physical trunk colliders while updating visible detail after camera movement, turning or projection changes. `canopy=0` remains a developer comparison override.

Full original component-preserving tree01 geometry is an opt-in `originaltree=1` prototype. Its indexed geometry is near 177,354 / mid 13,010 / far 5,309 / distant 2,228 triangles. The distant band fixes the observed rear-view base-cost overflow in this prototype, but coarse fallbacks can still appear at excessive screen size. Mid/far/distant leaf size compensation is 4.25/7/12 times; this is not authentic leaf size or photographic acceptance. The prototype stays off by default. `crown`, `leafvolume`, `coastform`, `ground` and geometry-refraction candidates also remain opt-in.

## Verification and limits

- 285 tests passed at `b12b9b2`, covering the independent LOD slots, real indexed triangle accounting, exclusive partitions, resize/turning and unchanged physical trunks, plus the existing world/controller/route/optics checks. Final `274fef0` changes two configuration expressions; TypeScript, Vite and embedded standalone build passed on that final source.
- Five before/after native images use the same 1280×720 camera, absolute eye height and clock 34. Counters are recorded in the rendered pose before capture restoration. Separate water/fish solver histories mean these pairs compare static foliage only. Earlier mismatched-size or after-restoration diagnostic images are excluded from aligned acceptance.
- Native pine fields used 1,327,204–2,959,534 and shrubs 583,316–1,258,714 triangles in those five views. These samples satisfy the individual budgets, not an unconditional bound for every view or arbitrary placement. Counts omit extra shadow/reflection rendering cost. Normal pixel-size overflow counters have no thresholds and are not a screen-quality pass.
- Seven normal rendered bookmarks cover spawn, shore, cliff, lookout, reef, Habushi front and Secret. These establish appearance, not surveyed camera positions or reachable full routes.
- One uninterrupted local sequence started at ordinary spawn and used the same controller input as touch movement: walk/wade → swim → dive (observed depth 7.68m) → resurface → physical ladder approach. Actual visible UI buttons initiated boarding and leaving. The helm moved about 29m under manual forward input, then the ladder descent ended in swimming beside the same boat. No viewpoint/mode reset or destination navigation was used during this sequence. Nine actual images and state observations are saved with the release. This is local rendered controller/UI evidence; it does not establish native keyboard, inter-island travel, real human dynamics or Human GO.
- R150 performed one fresh independent pass on exact source and 22 PNGs. It accepted the alias correction and view-aware native adoption as **PASS_BOUNDED**, independently counted the GLB indices, and rejected normal adoption or photo/botanical claims for the original-tree prototype. All five producer/verifier completed turns were read back as GPT-6.1 Sol low with the exact parent edge; they had writable runtime access, not a proven read-only sandbox.

## Remaining visual work

The giant photograph-painted leaf ground, smooth/banded cliffs, dark sea, sparse or coarse foliage and repeated sky still distinguish the world from real footage. Habushi's front bookmark shows a large flat foreground wall/seam; its geometry and physical approach need specific verification. Body, boat, full coastline fidelity, every route, real marine behaviour and multi-view Human acceptance remain incomplete. Tests and a attractive single image cannot close these requirements.

The original tree/material assets are CC0 source-derived assets with local byte verification. Google Maps and other protected reference pixels are not included in the runtime/source archive. Existing geometry-only Blender V20 diagnostics do not establish runtime PBR parity and are not promoted as new V21 evidence.
