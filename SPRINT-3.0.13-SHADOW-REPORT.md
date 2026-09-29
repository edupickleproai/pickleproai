# Sprint 3.0.13 — Explainable Shadow Pose Coherence Model v0

STATUS: PASS (implementation and stated validation).

DECISION: **B — SHADOW V0 IS TOO CONSERVATIVE BUT SAFE** on the evaluated controls. This is an empirical statement about this finite dataset, not a general safety guarantee or approval for production. No real malformed row reached STRONGLY_SUSPICIOUS; its conjunction is covered synthetically, not validated as a real-video discriminator.

## Model and interpretation

A pure deterministic function consumes fixed derived image-space measurements. It accepts no video, landmarks, pose index, detection source, player identity, timestamp or human label as decision input. An explicit measurement allowlist keeps extra metadata out of diagnostics too. Every assessment includes version shadow-v0 and authority NONE.

- NO_OBVIOUS_ANOMALY: neither active structural reason. This is not certification or evidence of a valid person.
- SUSPICIOUS: one active structural family; unusual geometry with legitimate alternatives.
- STRONGLY_SUSPICIOUS: both longitudinal inversion and transverse shoulder/hip opposition. This is still neither rejection nor identity evidence.
- INSUFFICIENT_EVIDENCE: required geometry is missing or mathematically uninterpretable. Takes precedence over structural reasons.

## Reasons, tiers and provisional boundaries

| Reason / rule | Tier | Exact boundary | Rationale / caveat |
|---|---|---|---|
| INSUFFICIENT_GEOMETRY | 0 | Missing/non-numeric/non-finite required values; bodyHeight, bboxAspect, bboxArea or torsoLength <= 0; torsoAngle outside [-180,180]; sideVectorCosine outside [-1−1e-12,1+1e-12]; or measurement producer reports unavailable | Positive extents/denominators and angle/cosine domains are arithmetic prerequisites, not fitted body-size rules. Optional unavailable diagnostics do not independently force abstention. |
| INVERTED_IMAGE_TORSO | 1 | abs(torsoAngle) > 90 degrees, strictly | The shoulder midpoint projects below hip midpoint. The 90-degree boundary is the image-horizontal transition, not a margin beyond a coherent maximum. Camera roll, inversion and genuine motion can cause it. Exactly ±90 is not flagged. |
| SHOULDER_HIP_VECTOR_OPPOSITION | 1 | sideVectorCosine < 0, strictly | Shoulder and hip anatomical left-to-right vectors are in opposing half-planes (>90-degree separation). Exactly zero is not flagged. Projection, twisting and label ambiguity remain alternatives. |
| Strong combination | decision | Both of the two structural families; one vote each | Two distinct geometric relationships, not repeated angles/ordering/ratios from the same relationship. They are not claimed statistically independent. Neither alone can produce STRONGLY_SUSPICIOUS. |

Cosine values within 1e-12 of the mathematical domain are clamped to [-1,1] for floating-point roundoff; 1e-12 is arithmetic tolerance, not a learned anomaly threshold. 180 degrees is the atan2 domain limit. Zero in positive-extent checks is arithmetic degeneracy, not a minimum person size. There are no other numerical decision boundaries. No thresholds were selected from coherent extrema, malformed extrema, timestamps, videos or individual cases.

Tier 2 has **no active promotion in v0**: there is insufficient justification for weak signals to strengthen suspicion. Bbox/body shape, torso inclination within the upper half-plane, shoulder/hip ordering and delta Y, limb ratios, asymmetry, distal distances, joint angles, torso/bbox ratio, point influence, IoU and visibility remain diagnostic-only. Multiple weak extremes combined cannot produce suspicion or promote one structural reason to strong suspicion. Ordering is not counted separately from torso angle.

## Data and evaluation method

Model rules were implemented and explained before evaluation. No rule was changed after examining evaluation output. Incidental malformed cases were a secondary holdout-like inspection, not a statistically independent held-out dataset: their earlier research findings were already known. No repeated tuning against them occurred. A later preparation rerun shortened anonymous result identifiers only; measurements, labels, grouping and model were unchanged.

Temporary input fixtures contain only set, id, observation, label and fixed measurement values. No videos, images, raw/world landmarks, credentials, private absolute paths or product session state are included. Fixture preparation and fixtures stay outside the repository. The repository contains only the generic offline evaluator, synthetic test values, implementation and this report; no research dataset fixture is added. The evaluator takes caller-supplied paths and is never imported by application code.

A–K measurements use the existing preserved transcription, unchanged; L–Z and corrected 12f/12h/12i use validated saved exports. No old capture was reconstructed, relabeled, remeasured or replaced. All labeled raw coherent rows are evaluated, including ordinary controls previously excluded from targeted gap quotas. Final/retained UNLABELED duplicates are excluded. UNCERTAIN rows are reported separately, never used as coherent or malformed ground truth.

118 rows total: 71 coherent, 7 fixed malformed, 25 incidental malformed, 15 uncertain. The primary coherent metric collapses known source duplicates by physical player/time within each reference set. Any strong source makes its observation strong; otherwise use SUSPICIOUS > INSUFFICIENT_EVIDENCE > NO_OBVIOUS_ANOMALY. Source-level results remain available. Distinct times are not claimed independent action trials: related overhead wind-up phases, recovery phases, adjacent Scorpion frames and other same-action neighbors remain correlated.

## Four-way confusion-style results

These compare human visual labels to diagnostic statuses, not accepted/rejected predictions.

| Evaluation population | NO_OBVIOUS_ANOMALY | SUSPICIOUS | STRONGLY_SUSPICIOUS | INSUFFICIENT_EVIDENCE |
|---|---:|---:|---:|---:|

| Coherent raw detections (71) | 71 | 0 | 0 | 0 |

| Coherent distinct player/time observations (49) | 49 | 0 | 0 | 0 |

| Fixed malformed A–G (7) | 4 | 3 | 0 | 0 |

| Incidental malformed (25) | 18 | 7 | 0 | 0 |

| Uncertain, not ground truth (15) | 13 | 2 | 0 | 0 |


**Primary safety metric: 0 / 49 distinct coherent player/time observations became STRONGLY_SUSPICIOUS.** Also 0 / 49 became SUSPICIOUS or INSUFFICIENT_EVIDENCE. Source-level strong count is 0 / 71. This result does not imply unseen poses, rotated cameras, inversions or crowded projections are safe.

## Fixed malformed A–G

| ID | Result | Reasons / contributing measurements |
|---|---|---|

| A | NO_OBVIOUS_ANOMALY | None; deliberately missed rather than add unsupported scalar rules. |

| B | NO_OBVIOUS_ANOMALY | None; deliberately missed rather than add unsupported scalar rules. |

| C | SUSPICIOUS | INVERTED_IMAGE_TORSO {"torsoAngle":-171.3} |

| D | NO_OBVIOUS_ANOMALY | None; deliberately missed rather than add unsupported scalar rules. |

| E | NO_OBVIOUS_ANOMALY | None; deliberately missed rather than add unsupported scalar rules. |

| F | SUSPICIOUS | SHOULDER_HIP_VECTOR_OPPOSITION {"sideVectorCosine":-0.922} |

| G | SUSPICIOUS | INVERTED_IMAGE_TORSO {"torsoAngle":179.7} |


A, B, D and E are known malformed despite a neutral result. This explicitly demonstrates that neutral does not certify a pose. C/G are inverted in the image; F has shoulder/hip vector opposition. None has both active reasons. The model was not expanded to achieve 7/7.

## Coherent coverage and correlated grouping

| Set | Coherent detections | Distinct player/time | Four-way distinct counts (neutral / suspicious / strong / insufficient) |
|---|---:|---:|---|
| H–K | 4 | 4 | 4 / 0 / 0 / 0 |
| L–Z | 15 | 12 | 12 / 0 / 0 / 0 |
| Corrected 12f | 24 | 15 | 15 / 0 / 0 / 0 |
| 12h, including 7 ordinary detections | 16 | 10 | 10 / 0 / 0 / 0 |
| 12i, including 8 ordinary detections | 12 | 8 | 8 / 0 / 0 / 0 |
| Total | 71 | 49 | 49 / 0 / 0 / 0 |

L–Z correlations: O/P, R/S, W/Y. Other H–Z rows remain distinct, including different physical players at the same timestamp. For 12f/12h/12i, preserved obs identifiers determine targeted grouping; ordinary source duplicates are h OUT04/OUT05, h OUT06/OUT07, i I-OUT03/I-OUT04 and i I-OUT07/I-OUT08. Ordinary defenders remain separate from attackers at the same time.

Known stress examples remain neutral: coherent asymmetry 5.125×, short forearm around 0.070, distal ratio 2.827, elbow around 4.9°, high duplicate-source IoU, very low visibility, and 12i extreme crouch bbox 1.4276 / torso angle 65.5762° / knee 54.1313°. No special exemption for these examples exists.

| Set | Grouped coherent IDs (one player/time) | Result |
|---|---|---|

| fixedHZ | H | NO_OBVIOUS_ANOMALY |

| fixedHZ | I | NO_OBVIOUS_ANOMALY |

| fixedHZ | J | NO_OBVIOUS_ANOMALY |

| fixedHZ | K | NO_OBVIOUS_ANOMALY |

| fixedHZ | L | NO_OBVIOUS_ANOMALY |

| fixedHZ | M | NO_OBVIOUS_ANOMALY |

| fixedHZ | N | NO_OBVIOUS_ANOMALY |

| fixedHZ | O, P | NO_OBVIOUS_ANOMALY |

| fixedHZ | Q | NO_OBVIOUS_ANOMALY |

| fixedHZ | R, S | NO_OBVIOUS_ANOMALY |

| fixedHZ | T | NO_OBVIOUS_ANOMALY |

| fixedHZ | U | NO_OBVIOUS_ANOMALY |

| fixedHZ | V | NO_OBVIOUS_ANOMALY |

| fixedHZ | W, Y | NO_OBVIOUS_ANOMALY |

| fixedHZ | X | NO_OBVIOUS_ANOMALY |

| fixedHZ | Z | NO_OBVIOUS_ANOMALY |

| f | AA | NO_OBVIOUS_ANOMALY |

| f | AB | NO_OBVIOUS_ANOMALY |

| f | AC | NO_OBVIOUS_ANOMALY |

| f | AD, AE | NO_OBVIOUS_ANOMALY |

| f | AF | NO_OBVIOUS_ANOMALY |

| f | AG, AH | NO_OBVIOUS_ANOMALY |

| f | AI, AJ, AK | NO_OBVIOUS_ANOMALY |

| f | AL, AM | NO_OBVIOUS_ANOMALY |

| f | AN | NO_OBVIOUS_ANOMALY |

| f | AO, AP | NO_OBVIOUS_ANOMALY |

| f | AQ, AR | NO_OBVIOUS_ANOMALY |

| f | AS | NO_OBVIOUS_ANOMALY |

| f | AV, AW | NO_OBVIOUS_ANOMALY |

| f | AX | NO_OBVIOUS_ANOMALY |

| f | AY, AZ | NO_OBVIOUS_ANOMALY |

| h | OUT01 | NO_OBVIOUS_ANOMALY |

| h | BB, BA | NO_OBVIOUS_ANOMALY |

| h | OUT02 | NO_OBVIOUS_ANOMALY |

| h | BC, BD | NO_OBVIOUS_ANOMALY |

| h | OUT03 | NO_OBVIOUS_ANOMALY |

| h | BE, BF | NO_OBVIOUS_ANOMALY |

| h | BG | NO_OBVIOUS_ANOMALY |

| h | OUT05, OUT04 | NO_OBVIOUS_ANOMALY |

| h | OUT07, OUT06 | NO_OBVIOUS_ANOMALY |

| h | BH, BI | NO_OBVIOUS_ANOMALY |

| i | I-OUT01 | NO_OBVIOUS_ANOMALY |

| i | I-OUT02 | NO_OBVIOUS_ANOMALY |

| i | CA, CB | NO_OBVIOUS_ANOMALY |

| i | I-OUT03, I-OUT04 | NO_OBVIOUS_ANOMALY |

| i | I-OUT05 | NO_OBVIOUS_ANOMALY |

| i | I-OUT06 | NO_OBVIOUS_ANOMALY |

| i | CC, CD | NO_OBVIOUS_ANOMALY |

| i | I-OUT07, I-OUT08 | NO_OBVIOUS_ANOMALY |

## Incidental malformed secondary results

14 corrected-12f cases: 9 neutral, 5 suspicious. Four 12h cases: 3 neutral, 1 suspicious. Seven 12i cases: 6 neutral, 1 suspicious. No strong or insufficient cases. These are detection-level counts; phantom bodies do not permit reliable physical-player grouping. Correlated crops/adjacent malformed detections do not count as independent accuracy trials.

| Set / ID | Result | Reasons / measurements |
|---|---|---|

| f / NEW-INC01 | NO_OBVIOUS_ANOMALY | None |

| f / NEW-INC02 | SUSPICIOUS | INVERTED_IMAGE_TORSO {"torsoAngle":-131.5235579400117} |

| f / NEW-INC03 | SUSPICIOUS | INVERTED_IMAGE_TORSO {"torsoAngle":99.19407070396232} |

| f / NEW-INC04 | SUSPICIOUS | SHOULDER_HIP_VECTOR_OPPOSITION {"sideVectorCosine":-0.15139509809242946} |

| f / NEW-INC05 | NO_OBVIOUS_ANOMALY | None |

| f / NEW-INC06 | NO_OBVIOUS_ANOMALY | None |

| f / NEW-INC07 | SUSPICIOUS | INVERTED_IMAGE_TORSO {"torsoAngle":-177.2145890891964} |

| f / NEW-INC08 | SUSPICIOUS | INVERTED_IMAGE_TORSO {"torsoAngle":-173.2438138507833} |

| f / NEW-INC09 | NO_OBVIOUS_ANOMALY | None |

| f / NEW-INC10 | NO_OBVIOUS_ANOMALY | None |

| f / NEW-INC11 | NO_OBVIOUS_ANOMALY | None |

| f / NEW-INC12 | NO_OBVIOUS_ANOMALY | None |

| f / NEW-INC13 | NO_OBVIOUS_ANOMALY | None |

| f / NEW-INC14 | NO_OBVIOUS_ANOMALY | None |

| h / M01 | NO_OBVIOUS_ANOMALY | None |

| h / M02 | NO_OBVIOUS_ANOMALY | None |

| h / M03 | SUSPICIOUS | INVERTED_IMAGE_TORSO {"torsoAngle":-164.44278324604713} |

| h / M04 | NO_OBVIOUS_ANOMALY | None |

| i / I-M01 | NO_OBVIOUS_ANOMALY | None |

| i / I-M02 | NO_OBVIOUS_ANOMALY | None |

| i / I-M03 | NO_OBVIOUS_ANOMALY | None |

| i / I-M04 | NO_OBVIOUS_ANOMALY | None |

| i / I-M05 | SUSPICIOUS | INVERTED_IMAGE_TORSO {"torsoAngle":113.29027048993149} |

| i / I-M06 | NO_OBVIOUS_ANOMALY | None |

| i / I-M07 | NO_OBVIOUS_ANOMALY | None |


Uncertain rows: 13 neutral, 2 suspicious (12f NEW-UNC01 and NEW-UNC05, inversion reason), zero strong or insufficient. No uncertain label was promoted to ground truth. Shadow detection of a camera-wearer shadow remains a known miss: geometric plausibility cannot establish physical person ownership.

## Zero-authority evidence and UI

- Only RawPoseResearch imports the model in application code. It is called only in a rendered diagnostic panel, on the selected row's already-derived measurements.
- No assessment enters rows, capture data, JSON exports, callbacks, ranking, filtering or product state. No product pipeline branches on status.
- Panel is collapsed by default and keyed to the selected row so switching rows resets its disclosure. It says RESEARCH ONLY — NO PRODUCT AUTHORITY and explains that neutral is not approval and suspicion is not rejection. It is placed after independent human label/note controls and fixed measurements.
- Component test forces STRONGLY_SUSPICIOUS and confirms unchanged research state, unchanged detection calls, and independent manual COHERENT label. Raw/final label linkage is unchanged.
- Import-boundary test rejects any additional application consumer. Existing tests verify authoritative phase/coaching modules and pre-existing page decision functions remain unchanged. Git changes contain no product route or tracking implementation.
- No changes to detection, dedup, candidate ranking, TARGET_A, competitor provenance, geometry qualification, harvesting, reacquisition, phases, biomechanics or coaching.

## Validation

Tests: **259 passed; 0 failed** — 28 new coherence/evaluator tests and 231 existing research/capture/phase/biomechanics/safety tests. Existing component isolation coverage was strengthened, not counted as a new test. All 17 capture tests and all 9 existing research tests pass. Tests cover mathematical invalidity, ordinary geometry, each unsafe weak feature alone and together, structural conjunction, determinism, boundary semantics, metadata invariance, input immutability, grouping, import isolation and human-label independence.

Commands: node --test tests/pose-coherence.test.cjs tests/pose-research.test.cjs tests/research-capture.test.cjs tests/phase-detection.test.cjs tests/coaching-biomechanics.test.cjs

The phase/coaching suites exercise mocked service/video handlers; no real-video QA or external AI analysis was run. Build: **PASS**, one npm run build invocation. Existing hook-dependency and image-element warnings appeared only in unchanged files; no new build error. Diff whitespace check passes.

## Known limitations and next step

No real malformed example reached strong suspicion, and most incidental malformed cases were missed. The structural conjunction is uncalibrated beyond synthetic tests. There is no learned confidence, probability, rejection threshold or certification. Mathematical sufficiency only means required measurements can be interpreted; it does not establish visible body ownership. Two geometric reasons can coexist legitimately under camera roll, inversion, twisting or severe projection.

Distinct extreme crouches, severe forward foreshortening and substantial crowded-player overlap remain underrepresented. The single 12i crowded example primarily proves foreground ownership, not recovery of a hidden background player. Small dataset size, human labels, selected difficult examples, source duplicates and adjacent phases prevent independent-population accuracy estimates.

**Next step:** broader real-video shadow-only validation, preserving visual labels before revealing diagnostics and specifically including the known crouch/foreshortening/crowded gaps plus rotated/inverted views. Do not integrate into product decisions. This recommendation was not implemented; no real-video QA occurred in this task.

## Files and Git

- src/lib/pose-coherence.ts — pure shadow assessment.
- src/app/pose-test/RawPoseResearch.tsx — collapsed, independent research display.
- tests/pose-coherence.test.cjs — 28 deterministic model/isolation/evaluation tests, synthetic measurements only.
- tests/evaluate-pose-coherence.cjs — offline sanitized-input evaluator.
- tests/pose-research.test.cjs — new import binding and strengthened component isolation assertion.
- tests/research-capture.test.cjs — bind model import in existing harness.
- SPRINT-3.0.13-SHADOW-REPORT.md — this sanitized report, not a research measurement fixture.

Branch feature/player-tracking. HEAD c033a7fc8fe5911c91b5792e5bac6d33ce488e0f. Working tree initially clean; now contains only these intended changes. No commit, push, merge or new branch. Research exports remain unchanged outside the repository.
