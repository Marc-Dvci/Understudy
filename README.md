# Understudy

A daily mirror exercise for someone practising with one weaker hand, with assistance set **finger by finger**. A seated WebXR routine at their own table, built by Marc Donovici for Meta Quest 3 / 3S and the Meta VR Start Developer Competition 2026.

![Per-finger assistance in the actual app, with labelled simulated history](docs/images/handover.jpg)

## Try it

Open the hosted build linked in the competition submission. On desktop Chrome or Edge, choose **Explore handover**. The short showcase starts with prepared sample measurements and offers **Handover**, **Progress** and **Hand Print** chapters. Compare Watch, Rehearse and Perform, pause to inspect a state, or open the complete later-session path with **Full app**.

Choose **Watch the first session**, then **Watch the demo**, for the complete onboarding and routine. Choose **Watch a later session** for a complete visit with three weeks of simulated history. These paths run the actual app in [Meta IWER, a browser-based immersive-session emulator](https://github.com/meta-quest/immersive-web-emulator).

The site's **See how it works and what has been verified** link opens a lightweight explanation page with a visit-by-visit sample and public evidence. It can be read without running the emulator.

On Quest 3 / 3S, open the plain build URL in Quest Browser, enable hand tracking, sit at a table and choose **Start**. Put controllers down. The table determines the station; the working hand drives the mirror and controls. Pause and Stop stay at the near edge. The prepared showcase is restricted to the desktop emulator.

[Judge guide](docs/JUDGE_GUIDE.md) · [Validation model and results](validation/REPORT.md)

Exercise prototype. Measurements are estimates. No participants or physical headsets were used. Physical headset accuracy, frame rate, comfort, anchor persistence and intended-user usability remain unverified. No clinical outcomes have been measured.

## The daily loop

**Measure → set assistance per finger → exercise → compare next time.**

Rest a working hand to establish a table from scene surfaces, resting fingertips, or a lap fallback. Choose the hand and programme. Understudy takes three trials of opening, fist and thumb reach, places a reflected hand over a felt cloth, then runs the day's exercises.

A deterministic coach plans each routine from the saved measurements. The first three visits use the four measured exercises (flower, piano, thumb, rhythm) to build a baseline. After that, the coach chooses the movement that lags the Lead hand most, then rotates in what was practised least recently: stones to the bowl (pinch, carry, release), turn the dial (forearm rotation), spread and close, and wave (wrist lift). Before the exercises, the board shows today's plan and one sentence per finger explaining its setting, for example "Index: 20% to 60%. Rose 40°, more than its 21° margin." A session that was stopped early makes the next one shorter. The mirrored hand performs every exercise too: in stones to the bowl, it reaches its own reflected stones.

The working hand is the **Lead**. The weaker hand is the **Understudy**. Watch follows the Lead's reflection; Rehearse blends it with tracked own movement; Perform follows own movement. The share is the rendered blend, not a measured percentage of effort.

Progress labels changes above or below an estimated error margin and places an earlier closed-hand pose beside the latest one. Each session ends with **Next visit**: the range at which each finger's assistance takes its next step, beside today's value, and the last 14 days as dots. Missed days are gaps; nothing counts streaks. The recurring purpose is a short routine at the same table, with an inspectable record of what changed.

Phantom offers recognition, imagery and mirror stages with a missing hand; Morning Warm-up fits a repeated-fist movement curve. **Desk Break** is two minutes for two working hands that type, click or play all day: a short Hand Print, then spread, wave, dial and stones with both hands, judged by the same margins. Both-hand setup offers Warm-up and Desk Break.

Every button supports one-hand poke, hover dwell, thumb confirmation and head-direction gaze. Head gaze means headset direction. Where a browser reports eye gaze as a WebXR transient pointer (look, then pinch), the stone looked at when the pinch starts is pressed when it ends. **Spoken** commands, off by default, press any visible stone by its label and also take "pause", "resume" and "stop"; negated phrases such as "don't stop" do nothing. Stop saves an unfinished record and returns Home. Settings includes skin tone, attended side, dwell, voice, spoken commands, a Calm or Playful style (petal bursts on each repetition, never scores), diagnostics, CSV export, a one-page care-team summary and confirmed erasure.

## Beyond the daily routine

- **Later visit** (Home): visit 22 inside the headset, over 21 simulated earlier visits in a temporary store, so the per-finger handover can be seen on day one. Personal history is reopened unchanged afterwards, and a stopped sample session is never saved.
- **Visit** (Home): two people at their own tables see each other's hands across the mat and open the flower together. One chooses Invite and reads out a four-digit code; the other chooses Join and enters it on a stone keypad. Only hand joints travel, 175 16-bit values per hand, about 36 times a second. Nothing is recorded. A relative, friend or therapist can keep someone company in a session.
- **Summary** (Settings): a standalone one-page HTML summary for a care team. It shows each measure's first and latest values, the change, its margin and verdict, a trend line with the usual range, and today's per-finger assistance. Simulated sessions are flagged. Open it in any browser and print it or share the file.

## How it works

~~~text
WebXR hand joints → kinematics → repeated trials → error estimate → assistance
          └─────→ reflection + own-motion blend → rendered mirror hand
                         local records → Progress / CSV
~~~

The Lead's 25 joint matrices reflect across the resting palms' midline. Joint-local rotation blending preserves bone lengths. Movement gain is capped; unavailable reference measurements cannot put invalid gains into the render. Thumb share follows the fingers' average because it has no separate finger-range metric.

Each Hand Print value needs sufficient tracked frames and at least two usable trials. The error prior comes from a stated synthetic tracker model; a personal estimate replaces it after five usable sessions. MDC95 = 1.96 × √2 × SEM. The handover changes a setting only when the recent range crosses the estimated margin relative to its last-change anchor. Progress uses its own historical baseline. Neither establishes clinical recovery.

History is separated by programme and hand role. Stopped sessions are excluded from progress and handover. Historical decisions use only measurements available on that day. The prepared showcase and full routine share the same assistance function. The showcase isolates the rendering comparison; the full routine also calibrates tracking noise and detects attempts.

## Evidence and limits

| Claim | Implementation | Verification |
|---|---|---|
| Each finger can blend the reflected and tracked movement | [Joint-local blend](src/core/rehearse.ts), [mirror system](src/app/mirror-system.ts) | [Mirror endpoints, local geometry and tracking fallback](tests/mirror.test.ts) |
| Assistance changes beyond an estimated error margin | [Shared assistance rule](src/core/assistance.ts), [causal history replay](src/core/records.ts) | [Assistance and unavailable readings](tests/assistance.test.ts), [margin and history](tests/core.test.ts) |
| Untracked measurements stay unavailable | [Measurement](src/core/measure.ts), [kinematics](src/core/kinematics.ts) | [Tracking gaps](tests/core.test.ts), [joint geometry](tests/kinematics.test.ts) |
| One-hand selection supports poke, dwell, thumb and head gaze | [Input](src/app/ui/press.ts) | [Input regressions](tests/press.test.ts), [retained emulator journeys](verification/emulator.json) |
| Samples stay separate from personal records; records can be exported or erased | [Storage](src/app/store.ts), [CSV](src/core/records.ts) | [Persistence, isolation and erasure](tests/store.test.ts), [CSV regressions](tests/core.test.ts) |
| A prepared desktop showcase exposes the actual blend and Progress | [Showcase](src/app/emulation/showcase.ts) | [Native-headset guard](tests/assistance.test.ts), [retained desktop checks](verification/desktop.json) |
| The coach's plan and every explanation follow from the records | [Coach](src/core/coach.ts) | [Plans, explanations, next-step hints, visited days](tests/coach.test.ts) |
| Forearm turn, wrist lift, pinch and repetitions are measured from joints | [Movement](src/core/movement.ts), [exercises](src/app/flow/exercises-more.ts) | [Movement regressions](tests/movement.test.ts) |
| Visit sends compact hand poses and rejects malformed frames | [Pose codec](src/core/pose-codec.ts), [link](src/app/visit-link.ts) | [Codec and message regressions](tests/pose-codec.test.ts) |
| Spoken commands press only an unambiguous visible stone | [Voice intent](src/core/voice-intent.ts) | [Matching, negation and ambiguity](tests/voice-intent.test.ts) |
| The care summary escapes data and never prints invalid numbers | [Summary](src/core/report.ts) | [Summary regressions](tests/report.test.ts) |

178 automated unit tests pass. Four complete first-session emulator input journeys and 60 room-placement checks are retained evidence. The current showcase, first-session regression and offline project path passed their desktop checks; [software and emulator summaries](verification) record their scope. Production offline operation, interruption controls, export/erase and disconnected-hand paths were exercised in the emulator. Dates, model assumptions and the original reference bars are retained in the [validation report](validation/REPORT.md) and [simulation reference](validation/PREREGISTRATION.md).

The stated 5° attempt simulation reaches 23.4% single-finger sensitivity and misses its original 90% target. Very small attempts can be missed. Software checks and desktop render budgets do not establish the competition's minimum 60 fps on Quest hardware.

## Run locally

Use Node 22.12+ or 24 LTS; Node 26+ is also supported. The CI workflow uses .nvmrc. On Windows, use npm.cmd / npx.cmd when PowerShell blocks their .ps1 shims.

~~~powershell
npm.cmd ci
npm.cmd run dev
~~~

Open the managed HTTPS runtime, normally https://localhost:8081/. To stop it, run npm.cmd run dev:down. Supported headset browsers use native WebXR; desktop production builds include the emulator.

~~~powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run validate
npm.cmd run build
npm.cmd run preview -- --host 127.0.0.1
~~~

The test run produces the software-check summary used by the explanation page. A build also generates the interactive sample from the app's own model, then stamps the complete offline cache. Validation reproduces the stated synthetic S2–S5 and S11 checks. Existing bundled speech and models need no generation tools or Python at runtime.

Useful preview routes: ?fresh for first onboarding, ?fresh&seed=21 for a complete later session, ?fresh&program=deskbreak for a desk break, ?fresh&seed=3&goto=later for the in-headset later visit, and ?fresh&showcase=handover, progress or measurement for the short desktop chapters. Two tabs of ?seed=2&visit=local&visitcode=4321&goto=visit&visitrole=host and &visitrole=join run a Visit over a local browser channel. All sample routes use separate temporary storage. The plain URL on a headset uses personal records.

## Privacy and hosting

No login or application data server. Personal records live in IndexedDB. Samples use memory. If storage is unavailable, the app keeps the current records in memory and explains how to export. Erase removes sessions, settings and the stored anchor. Hosting providers receive normal asset requests; offline use needs one successful online visit.

Visit uses a peer-to-peer WebRTC connection. The public PeerJS broker only introduces the two browsers by their four-digit code; hand joints then travel directly between them and are not stored. Spoken commands use the browser's own speech recognition, which may process audio on the browser vendor's service; they are off by default.

The Pages workflow checks types, runs unit tests, builds the application and uploads the deployable artifact. Deployment runs when the repository is public and GitHub Actions is selected as the Pages source. The relative asset paths support the repository's project URL. Verify that exact HTTPS path before submitting, then keep the submitted build unchanged after the deadline.

## Licenses

Understudy is MIT, copyright Marc Donovici. Bundled third-party notices are retained: IWSDK, IWER and Three (MIT), PeerJS (MIT), WebXR generic hand assets (MIT), Atkinson Hyperlegible (SIL Open Font License 1.1), and generated speech from Kokoro-82M (Apache 2.0).
