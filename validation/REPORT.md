# Validation report

Synthetic checks were recorded on 5 October 2026 at 18:48 UTC; input journeys and geometry checks at 18:52 UTC. The retained room-placement run dates to 24 September 2026 at 20:57 UTC. The [public emulator summary](../verification/emulator.json) preserves those results. Reference bars were specified before their checks were written and are retained in [the simulation reference](PREREGISTRATION.md). They are project thresholds, not an externally registered study protocol.

Everything here is simulated or emulated. The simulation checks the software's logic under a stated tracker error model; the emulator checks the app in Meta's IWER runtime with scanned rooms. The tracker's own accuracy comes from the published Quest 2 figures (9.6 deg mean joint-angle error, 1.1 cm fingertip error, 45 ms delay). Clinical outcomes belong in a future prospective study.

## Summary

| ID | Check | Pre-registered bar | Result | |
|---|---|---|---|---|
| S1 | Joint angles from noise-free hands | <= 0.1 deg flexion, <= 0.05 deg abduction | exact to float precision (tests/kinematics.test.ts) | pass |
| S2 | Test-retest error per metric | computed, shipped as prior | index 7.5 deg SEM, MDC95 20.8 deg | reported |
| S3 | Hand-over follows recovery, ignores noise | <= 2% moves when flat; steady error <= 0.15 | 0.24% moves when flat; steady median error 0.062 | pass |
| S4 | Attempt gating on 5 deg attempts | <= 1 false/min; >= 90% detection | 0.66 false/min; 23% single-finger, 89.5% whole-hand | **not met** |
| S5 | Warm-up stiffness recovery | Spearman >= 0.9 | 0.973 over 200 curves | pass |
| S6 | Station in unknown rooms | found with <= 1 fallback, height within 1.5 cm | 60/60 cells; max height error 0.31 cm | pass |
| S7 | Journey in every input mode | completes in each | lead-right ok, lead-left ok, dwell-only ok, gaze-only ok | pass |
| S8 | Interactive elements inside the Glasses view | 100% | 25312 corner checks, worst 15.0 deg above gaze (limit 25) | pass |
| S9 | App render budget (demo room off) | <= 80 draw calls, <= 120000 triangles | max 66 calls, 44612 triangles | pass |
| S10 | Mirror vs independently built opposite hand | <= 2e-6 | float32 agreement (tests/mirror.test.ts) | pass |
| S11 | Replays are deterministic | bit-identical | identical | pass |

## S2: measurement error per Hand Print metric

24 simulated users (half healthy, half impaired) x 20 sessions, three trials per movement, default tracker model. SEM is the standard deviation of a session value across sessions; MDC95 = 1.96 x sqrt(2) x SEM. These values are the app's starting prior; each user's own error replaces them after five sessions.

| Metric | SEM | MDC95 |
|---|---|---|
| Index range (TAM) | 7.5 deg | 20.8 deg |
| Middle range (TAM) | 6.5 deg | 17.9 deg |
| Ring range (TAM) | 6.9 deg | 19.1 deg |
| Little range (TAM) | 6.1 deg | 16.8 deg |
| Whole-hand range (TAM) | 13.6 deg | 37.6 deg |
| Hand opening | 0.5 pp | 1.3 pp |
| Finger spread | 2.7 deg | 7.4 deg |
| Thumb reach (Kapandji, 0 to 10) | 1.1 pts | 3.2 pts |

The in-app estimator, given ten sessions, recovers the true SEM with a median ratio of 0.96 (range 0.56 to 1.36).

Sensitivity to the assumed session bias (index range SEM): 4.7 deg at 3 deg, 7.5 deg at 6 deg (default), 12.4 deg at 9 deg.

## S3: hand-over over 8 weeks

50 synthetic patients per trajectory, 3 sessions a week, MDC 20.8 deg.

S3 holds the MDC constant at the S2 reference. The app recalculates personal error from historical prefixes. This reference-rule simulation does not measure the complete adaptive pipeline's false-move rate on a physical device.

| Trajectory | Share moves per session | Final share error, median | 90th percentile |
|---|---|---|---|
| steady | 8.1% | 0.059 | 0.138 |
| plateau | 9.3% | 0.051 | 0.122 |
| none | 0.2% | 0.082 | 0.131 |
| relapse | 15.3% | 0.161 | 0.260 |

## S4: attempt gating

Detector parameters were tuned on development seeds (15 settings; chosen k = 2.5, smoothing 0.25 s) and scored once on held-out seeds. The shipped defaults equal the chosen setting: true. The fixed-size sweep below uses a separate simulated sample from the headline held-out cohort.

| Attempt size (summed finger flexion) | Single finger | Whole hand |
|---|---|---|
| 5 deg | 27% | 93% |
| 10 deg | 94% | 100% |
| 15 deg | 100% | 100% |
| 20 deg | 100% | 100% |

False attempts with a still hand while the Lead hand moves: 0.66 per minute per finger, 0.55 per minute for the whole-hand detector.

In the held-out cohort, whole-hand attempts of 5 deg are detected 89.5% of the time. In the fixed-size sweep, single-finger attempts of 10 deg are detected 94% of the time. The app opens a finger's gate on either detector: a whole-hand attempt opens every finger, and a single-finger attempt opens that finger. The original 90% detection target for 5 deg attempts is not met. Small attempts can be missed; this limits Rehearse and is not evidence of absent effort or recovery.

## S6: rooms the app was never tuned on

Five scanned rooms from IWER's Synthetic Environment Module, table label kept and removed, three seated eye heights (0.36, 0.42, 0.48 m above the table), Meta Quest 3 and Meta VR Glasses profiles.

This placement run was recorded on 24 September 2026 at 20:57 UTC. Device profiles emulate layout and room data. Physical headset tracking and frame rate remain unverified.

| Device, room | Cells passed | Station sources | Max height error |
|---|---|---|---|
| metaQuest3 | living_room | 6/6 | table-label, flat-hand | 0.25 cm |
| metaQuest3 | meeting_room | 6/6 | table-label, flat-hand | 0.25 cm |
| metaQuest3 | music_room | 6/6 | table-label, lap | 0.31 cm |
| metaQuest3 | office_large | 6/6 | table-label, flat-hand | 0.27 cm |
| metaQuest3 | office_small | 6/6 | table-label, flat-hand | 0.25 cm |
| metaVRGlasses | living_room | 6/6 | table-label, flat-hand | 0.25 cm |
| metaVRGlasses | meeting_room | 6/6 | table-label, flat-hand | 0.22 cm |
| metaVRGlasses | music_room | 6/6 | table-label, lap | 0.31 cm |
| metaVRGlasses | office_large | 6/6 | table-label, flat-hand | 0.27 cm |
| metaVRGlasses | office_small | 6/6 | table-label, flat-hand | 0.25 cm |

Without labels the station comes from the resting fingertips; on the music room's 47 cm coffee table it correctly switches to lap mode.

## S7 to S9: end to end in the emulator

| Mode | Journey | Press methods used | Max draw calls | Max triangles |
|---|---|---|---|---|
| lead-right | completed in 192 s | poke x3 | 66 | 44612 |
| lead-left | completed in 192 s | poke x3 | 66 | 44612 |
| dwell-only | completed in 195 s | dwell x3 | 66 | 44612 |
| gaze-only | completed in 194 s | gaze x3 | 66 | 44612 |

Reading panels (reported, outside the S8 interaction check): 100% of samples fit inside the Glasses view when looked at directly. The card and board are placed for an upward glance from the mat.

The four S7 modes describe button input. The simulated actor supplies both hands during the measurement movements. These runs do not prove measurements work without the measured hand. Head gaze is headset direction, not eye tracking. S9 is a geometry budget, not a measured Quest frame rate.

## October regression checks

Generated 2026-10-05T18:48:52.789Z against https://localhost:4177/Understudy/. Input selections use the emulated headset and the production gaze dwell path.

- gaze Pause freezes the flow clock: pass
- gaze Resume restores the same exercise: pass
- gaze Stop returns Home, saves an unfinished record and removes exercise objects: pass
- gaze Export downloads CSV with trials, quality and sample/unfinished labels: pass
- gaze Keep data cancels erase without changing history: pass
- gaze Erase clears the temporary sample history after confirmation: pass
- Phantom completes with the left hand disconnected throughout: pass
- Phantom completes with the right hand disconnected throughout: pass

Page errors: 0. Overall: pass. Storage regressions additionally cover IndexedDB transaction aborts, write failure, sample isolation, NaN readings, deletion after fallback and immutable snapshots in `tests/store.test.ts`. Dwell regressions cover hand loss, target exit, mixed hands and Pause input restrictions in `tests/press.test.ts`.

Phantom checks above cover the first recognition session, not all later imagery and mirror stages.

## Watch with an untracked Understudy hand

Generated 2026-10-03T15:58:48.892Z, query ?fresh&demo&noroom&missing=left. Overall: pass; page errors: 0.

- Watch completes using one tracked Lead hand
- No guessed position result
- All missing-hand metrics unavailable with zero tracking share
- Every assistance share remains zero
