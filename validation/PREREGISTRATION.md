# Simulated validation: pre-registered thresholds

Committed before the checks below are implemented or run. Every result is
produced by the simulation in `src/sim/` and the tests in `tests/`. The
simulation verifies the software's logic under a stated tracker error model.
It does not measure the accuracy of a physical tracker or any clinical effect.

## Tracker error model (assumption)

Source figure: Meta Quest 2 hand tracking, mean fingertip position error
1.1 cm, mean joint-angle error 9.6 degrees, delay 45 ms (Abdlkarim et al.,
"A methodological framework to assess the accuracy of virtual reality
hand-tracking systems", PMC10830632).

The paper reports totals only. The split below is an assumption:

| Component | Model | Default |
|---|---|---|
| Static bias | per user, hand and joint; constant across sessions | sigma 10 deg |
| Session bias | redrawn every session (re-donning, light, placement) | sigma 6 deg |
| Jitter | AR(1) per joint per frame, 72 Hz, correlation time 60 ms | sigma 2 deg |
| Occlusion | flexion under-read by 8% when summed finger flexion exceeds 180 deg; 3% frame dropouts in bursts | on |
| Delay | 45 ms shift | on |

Total sigma is about 11.8 deg, a mean absolute error of about 9.4 deg, close to
the published 9.6 deg. The session-bias sigma sets the minimal detectable
change, so S2 and S3 are also reported at 3 and 9 deg.

## Thresholds

| ID | Check | Pass |
|---|---|---|
| S1 | Joint angles from noise-free procedural hands | error <= 0.1 deg on every finger joint; abduction <= 0.05 deg |
| S2 | Test-retest of each Hand Print metric under the default model | MDC95 computed per metric and shipped as the app's prior; no pass bar |
| S3 | Hand-over on 200 synthetic patients x 4 recovery trajectories x 8 weeks | share moves on <= 2% of sessions for flat trajectories; share within 0.15 of ground truth at week 8 for steady recovery |
| S4 | Attempt gating | <= 1 false attempt per minute per finger on still hands; >= 90% detection of 5 deg attempts |
| S5 | Warm-up stiffness recovery on synthetic curves | Spearman rank correlation with ground truth >= 0.9 |
| S6 | Station in emulated rooms: 5 SEM rooms x table label kept/removed x 3 seat heights x 2 devices | station found in every cell with at most one fallback step |
| S7 | One-handed journey: left only, right only, dwell only, head-gaze only | completed in every mode |
| S8 | Every interactive element inside the Meta VR Glasses visibility mask at the station pose | 100% |
| S9 | Static render budget | <= 80 draw calls and <= 120k triangles in every state |
| S10 | Mirrored Lead hand vs independently built opposite hand | float32 agreement (<= 2e-6) |
| S11 | Replaying one recording twice | bit-identical metrics |
