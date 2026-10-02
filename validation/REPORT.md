# Validation report

Generated from `validation/results.json` (2026-09-24T21:00:58.287Z), `validation/e2e-results.json` (2026-10-02T21:47:40.379Z) and `validation/s6-results.json` (2026-09-24T20:57:20.859Z) by `tools/report.mjs`. Thresholds for S2 to S9 and S11 were committed in `validation/PREREGISTRATION.md` before those checks were written; the S1 and S10 bars were set in the implementation plan before their tests.

Everything here is simulated or emulated. The simulation checks the software's logic under a stated tracker error model; the emulator checks the app in Meta's IWER runtime with scanned rooms. The tracker's own accuracy comes from the published Quest 2 figures (9.6 deg mean joint-angle error, 1.1 cm fingertip error, 45 ms delay). No clinical effect is measured.

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
| S8 | Interactive elements inside the Glasses view | 100% | 1548 corner checks, worst 11.2 deg above gaze (limit 25) | pass |
| S9 | Render budget | <= 80 draw calls, <= 120000 triangles | max 66 calls, 67128 triangles | pass |
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

| Trajectory | Share moves per session | Final share error, median | 90th percentile |
|---|---|---|---|
| steady | 8.1% | 0.059 | 0.138 |
| plateau | 9.3% | 0.051 | 0.122 |
| none | 0.2% | 0.082 | 0.131 |
| relapse | 15.3% | 0.161 | 0.260 |

## S4: attempt gating

Detector parameters were tuned on development seeds (15 settings; chosen k = 2.5, smoothing 0.25 s) and scored once on held-out seeds. The shipped defaults equal the chosen setting: true.

| Attempt size (summed finger flexion) | Single finger | Whole hand |
|---|---|---|
| 5 deg | 27% | 93% |
| 10 deg | 94% | 100% |
| 15 deg | 100% | 100% |
| 20 deg | 100% | 100% |

False attempts with a still hand while the Lead hand moves: 0.66 per minute per finger, 0.55 per minute for the whole-hand detector.

The pre-registered bar (90% at 5 deg) is not met for single fingers. Whole-hand attempts of 5 deg are detected 89.5% of the time and single-finger attempts from 10 deg 94% of the time. The app therefore opens a finger's gate on either detector: a whole-hand attempt opens every finger, and a single-finger attempt opens that finger.

## S6: rooms the app was never tuned on

Five scanned rooms from IWER's Synthetic Environment Module, table label kept and removed, three seated eye heights (0.36, 0.42, 0.48 m above the table), Meta Quest 3 and Meta VR Glasses profiles.

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
| lead-right | completed in 112 s | poke x3 | 66 | 67128 |
| lead-left | completed in 112 s | poke x3 | 66 | 67128 |
| dwell-only | completed in 115 s | dwell x3 | 66 | 67128 |
| gaze-only | completed in 113 s | gaze x3 | 66 | 67128 |

Reading panels (reported, not part of S8): 100% of panel samples fit inside the Glasses view when looked at directly; 0% are fully visible while looking at the mat centre, so the card and board need a glance upward on the Glasses.
