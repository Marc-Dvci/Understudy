# Frame budget

Understudy is built to hold Quest's frame budget with the full materials, geometry and textures shown in the demo video. This page lists what a session does on the headset, what was measured, and how to read the frame rate on a Quest.

## What a session does on the headset

| Measure | How | Effect on the image |
|---|---|---|
| 72 Hz | Each session requests 72 Hz from the headset's supported rates ([quality.ts](../src/app/quality.ts)). On Quest 3 and 3S it is the lowest rate above the 60 fps floor, so each frame has 13.9 ms, against 11.1 ms at 90 Hz. | None |
| Both eyes in one pass | Immersive Web SDK creates the renderer with multiview stereo. Where Quest Browser provides WebXR layers and `OCULUS_multiview`, Three.js draws both eyes in one pass instead of two. | None |
| No shader pauses | A headset compiles a shader the first time an object uses it, and that frame waits. Every program the routine can draw compiles during the first frames, while the table is being found, a few milliseconds per frame ([warmup.ts](../src/app/render/warmup.ts)). Hidden stand-ins cover objects created later: stones, flower petals and Playful petal bursts. Static textures upload in the same pass. | None |
| Only the features it reads | Hand tracking, anchors, plane and mesh detection and hit test ([iwsdk.config.json](../iwsdk.config.json)). No depth-sensing request: depth-only hand geometry keeps real fingers in front of virtual objects. Table labels are read from the frame while the station is being placed, not polled for every plane and mesh each frame. | None |
| Redraw on change | Cards, stone faces and the live finger meter upload a new texture only when their content changes. | None |
| Cloth and hands | The cloth animates with the exact affine transform of its drape (all 3,869 vertices and 7,488 triangles kept). Static hand-model transforms are computed once; joint matrices update from every pose. | None |
| Fixed foveation | 0.5 throughout the session. The governor never raises it or removes material detail. | Unchanged |
| Governor | If frames stay long for two seconds, the session requests a lower supported rate of at least 60 Hz. It resets with every session. | Rate only |

Render budget: at most 80 draw calls and 120,000 triangles in every state, with the demo room off. The four input journeys peak at 76 calls and 63,128 triangles ([e2e-results.json](../verification/e2e-results.json)).

## Measured

`tools/check-frame-work.mjs` runs a complete later session (`?fresh&seed=21&demo&noroom`: Hand Print, coach, cloth, four table exercises, Progress, Next visit, Home) in Windows Chromium with Meta IWER, with the page's CPU slowed 4× through the DevTools protocol. It times every frame's work in the app's systems and in Three.js render submission, and records every shader program compiled after the session starts. GPU execution is outside this measure.

Two runs of each build, alternated:

| Complete later session, CPU slowed 4× | Before (`4593144`) | After |
|---|---:|---:|
| Shader programs compiled during the routine | 7 and 7 | 0 and 0 |
| Longest frame after the first two seconds | 306 and 280 ms | 66 and 64 ms |
| Frame work, median | 4.7 and 4.8 ms | 5.0 and 5.5 ms |
| Frame work, 95th percentile | 6.6 and 6.6 ms | 6.8 and 7.6 ms |

Before the change, programs compiled as the table, the Home stones, the cloth, the flower and the Progress ghost hand first appeared, holding those frames for 24 to 306 ms. After it, the warm-up compiles 20 programs and uploads 11 textures over 13 frames (73 ms of work in total) while the table is being found, and nothing compiles during the routine. Steady frame work is unchanged within run-to-run variation: a per-system profile of both builds agrees within 0.15 ms per frame. The published runs are [frame-work.json](../verification/frame-work.json) and [frame-work-before.json](../verification/frame-work-before.json).

## Read the frame rate on a Quest

Open **Settings → Device check**. It shows this session's median frame rate, the requested refresh rate, the share of frames within the 60 fps budget (16.7 ms), and a short code with the same values. The Meta Quest Developer Hub performance overlay and OVR Metrics Tool report the compositor's own rate.

## Reproduce

```powershell
npm.cmd run build
npx vite preview --host 127.0.0.1 --port 4181
# in another window
$env:APP_URL='https://127.0.0.1:4181/'; node tools/check-frame-work.mjs
```

`CPU_RATE` sets the slowdown (default 4) and `QUERY` the route. The render budget comes from `node tools/e2e-suite.mjs` against the dev server.
