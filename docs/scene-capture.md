# Scene capture helper

`src/qa/scene-capture.ts` provides `captureNamed` and a bounded seven-bookmark `captureMatrix`. The caller supplies the browser-local engine adapter. Only Root owns the authenticated browser, viewport and GPU; this helper never opens a browser or resizes it.

Root integration:

```ts
import { captureMatrix } from './qa/scene-capture';
const sceneCaptureHost = /* SceneCaptureHost adapter over the current ocean and __seaQA */;
window.__captureMatrix = () => captureMatrix(sceneCaptureHost, { quality: 'high', preset: 'day', width: 1280, height: 720 }, saveCapture);
```

The adapter must expose `ready`, real setters and `readState()` containing camera position/quaternion (flat numeric array), pose, drawing-buffer dimensions, actual quality/preset/pause/lock and hidden/disposed flags. `nextFrame` wraps `requestAnimationFrame`. `restoreState` is **synchronous** and restores the exact pose/quality/preset/pause/lock snapshot; it must not call `home()`, move/reset the boat, or reset a route. Preserve captured camera orientation exactly rather than inventing a boat pose. Keep the adapter on a dedicated QA instance if the engine cannot restore the prior normal-play state.

`saveCapture(result, index)` may send PNG and metadata to Root's existing filesystem writer. Do not print entire data URLs to chat. Return only metadata/file names from the Root-facing command when practical. Set the viewport to 1280x720 before invoking. Two stable RAF observations are required after each viewpoint. Any subsequent camera/dimension change, hidden/disposed state, null PNG, timeout or callback failure aborts the matrix and restores state. A timed-out pending PNG retains exclusive capture ownership until its promise settles, while the scene lock is restored immediately.

The Secret bookmark is near the official municipal surf marker, with a dry beach offset selected from the current DEM sampler. It does not establish surveyed camera coordinates. Boat/helm evidence must enter through normal interaction and actual boat state, and must not use an invented pose mode. All metadata says `visual-only`, `movementVerified: false`, `humanAccepted: false`.

When transferring PNGs through CDP, Root calls `captureNamed` serially and saves each PNG immediately. One large multi-PNG response produced missing/corrupt transferred bytes despite successful engine captures; therefore validate decoded images and do not accept an incomplete response as a full matrix. Six individually transferred 1280x720 PNGs decode successfully. The normal gameplay page is preserved, and the separate QA page requires `capture=1`.

Focused fake-host tests cover ordering, restore, null/error, hidden/disposed, resized buffers, timeout, callback errors and exclusivity. Actual browser performance and GPU PNG fidelity remain unmeasured until Root runs the adapter.
