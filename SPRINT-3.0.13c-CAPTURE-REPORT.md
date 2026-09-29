# Sprint 3.0.13c — Reliable Research Batch Capture

Date: 2026-09-28. Branch: `feature/player-tracking`. HEAD: `c033a7fc8fe5911c91b5792e5bac6d33ce488e0f`.

**STATUS: PARTIAL. DECISION: B — IMPROVED BUT BELOW RELIABILITY TARGET. CHECKPOINT: CORRECTION REQUIRED.**

The final built application completed the prescribed first three videos and all 15 fixed timestamps: 10 first-attempt verified captures, zero retry successes, and five rejected captures after three attempts each. The 66.7% verified rate misses the 90% engineering target. The remaining nine videos were not attempted. No failed sample was replaced, no timestamp was shifted, and no broad Shadow v0 labeling was performed.

## Root cause and reproduction

Before changing code, the existing built helper reproduced the Sprint 3.0.13b failure on `VID-Caique e Theo.mp4`, requested 10.5 seconds:

`UNVERIFIED: load timed out (requested 10.5s; cursor 0s; last presented 0; seeking false; ready 4). No research record created.`

The original UI did not expose transaction event history. Accordingly, event times unavailable from that first unchanged-code attempt are not reconstructed. Subsequent instrumentation retained the original wait/seek behavior and reproduced the race at 10.5 and 2.6 seconds before the capture strategy was changed.

| Instrumented reproduction | 10.5 s | 2.6 s |
|---|---:|---:|
| Transaction | research-3-10.5 | research-4-2.6 |
| loadedmetadata, elapsed ms | 156.9 | 68.2 |
| Initial callback received, elapsed ms | 296.8 | 334.6 |
| Callback mediaTime / presentedFrames | 0 / 1 | 0 / 1 |
| readyState inside callback | 1 | 1 |
| Replacement callback registered, elapsed ms | 296.8 | 334.7 |
| loadeddata, elapsed ms | 297.3 | 336.0 |
| readyState at loadeddata and timeout | 4 | 4 |
| currentTime throughout | 0 | 0 |
| Paused / cancelled / changed source | true / false / false | true / false / false |
| Seek start / seeked | not reached | not reached |
| Replacement callback | never received | never received |
| Timeout | initial presentation, 15-second watchdog | initial presentation, 15-second watchdog |
| Classification | PRESENTATION_TIMEOUT | PRESENTATION_TIMEOUT |

The helper discarded the initial callback because readyState was still 1, then waited for another callback on a paused video. loadeddata updated readiness but did not produce another presentation. The race is between presentation notification and HTML video readiness, not a slow seek or an insufficient 15-second timeout. An initial pre-source-assignment diagnostic flag on the 2.6-second run was an instrumentation artifact; no source was replaced during that attempt.

Stabilization also exposed the same race at the sought frame: at request 5.233, the callback reported mediaTime 5.225, readyState 1, and seeking true at 185.1 ms. seeked arrived at readyState 4 around 187.3 ms, but the replacement paused callback never arrived. A separate sub-attempt subsequently verified the same timestamp, establishing that failures could be transient.

Separately, non-foreground runs delivered callbacks roughly one second apart while media presentation counts advanced by many frames. For example, requested 13.133 produced 13.11, 14.06, and 15.073333 with counts 2, 30, and 61. The page can report `visibilityState: visible` while presentation remains throttled. Showing the browser alone did not establish that the task pane was foregrounded. The user kept this task's browser pane open for final validation.

Experiments were kept separate from the final matrix. A same-position re-seek without advancing a presentation did not reliably generate a callback and was rejected as a strategy. Intermediate development hot reloads reset some in-memory experimental histories; the final native export below contains the complete final-run history, not a reconstructed or selectively filtered record of all development experiments.

## Implemented capture state machine

Each sub-attempt owns a new video element, source identity, callback handles, event listeners, watchdogs, and an alive/cancellation guard. Transitions and observations include elapsed and stage-relative times, readyState, currentTime, paused/seeking state, cancellation, source changes, visibility, playback rate, mediaTime, and presentedFrames.

Capture proceeds through IDLE, PREPARING_VIDEO, SEEKING, WAITING_FOR_PRESENTATION, FREEZING_FRAME, VERIFYING, and READY_FOR_DETECTION. Failures terminate in FAILED or CANCELLED. The serial batch result reaches COMPLETE only after the capture, detection, and research-record operation finishes. Presentation can precede seeked, so the candidate may freeze before the seek waiter completes; both must finish successfully before verification.

Preparation drains the initial callback independently of loadeddata without using its pixels. It warms the exact requested position, drains that presentation, advances one witnessed presentation at 0.25x playback, pauses, and then seeks back to the exact original requested timestamp. Warm-up pixels are never accepted as the candidate. A small temporary visible research preview gives the decoder a presentation surface and is removed during cleanup. Playback rate is explicitly applied after loading as well as before witness playback.

The candidate image is frozen synchronously inside its own callback, at readyState >= 2 and the exact requested cursor. The existing two-following-presentation verification then runs unchanged. Slower playback changes scheduling, not media timestamps or verification tolerances.

## Retry policy

At most three independent attempts per requested timestamp, always with that same timestamp. A retry creates a fresh decoder and distinct attempt/element IDs. Every rejected sub-attempt remains in diagnostics, including when a later one succeeds.

Only SEEK_TIMEOUT, PRESENTATION_TIMEOUT, PRESENTATION_SKIPPED, and VIDEO_NOT_READY permit another attempt. Source changes, cancellation/staleness, decode errors, unsupported APIs, invalid input, and other failures stop without retry. The existing 15-second per-wait watchdog was not increased. Load, seek, initial/warm/candidate/following presentation, and play waits have specific timeout descriptions.

## Source transitions and batch helper

`runResearchBatch` awaits capture, verification, detection, and record publication before processing the next ordered timestamp. The component's processing lock remains held until old detection settles, including after a source change. This prevents a new source from overlapping an old research detection. Source changes abort with SOURCE_CHANGE; stale results cannot create rows. Historical rejected diagnostics remain attributable to their original video/run. Clear-session and unmount invalidation prevent old diagnostics from repopulating a cleared session.

The development-only UI accepts the current uploaded video and an ordered list of 1–100 timestamps. It emits a VERIFIED/COMPLETE result or a REJECTED result with category, message, and attempt history. It includes cancellation, a diagnostic preview, and native diagnostic JSON export. No pose is auto-labeled. All 40 raw/final pose rows produced during final validation remained UNLABELED.

## Verification safety

- `verifyTiming` is text-equivalent to the checkpoint version, enforced by a test. Timestamp coverage, consistent media cadence, consecutive presentation counts, and requested cursor checks remain intact.
- Requested and actual presentation times remain separate. Pixels freeze only inside the candidate callback, before witness playback.
- Frozen-frame and detector-input fingerprints retain the same implementation and checks.
- Invalid, skipped, cancelled, stale, or unverifiable captures never become valid research pose rows.
- All ten successful final captures have distinct fingerprints. The four timestamps shared with the prior successful native export match their prior frozen-image fingerprints exactly: V01 5.233/7.867 and V02 8.033/20.133. This is a comparison of already saved evidence, not new video remeasurement.

## Final validation matrix

Final production build, localhost port 3003, foreground task browser pane, unchanged predetermined 3.0.13b timestamps. No development hot reload during this run.

| Video | Requests | Sub-attempts | First-pass verified | Retry verified | Rejected | Verified |
|---|---:|---:|---:|---:|---:|---:|
| V01 — VID-Caique e Theo.mp4 | 5 | 5 | 5 | 0 | 0 | 100% |
| V02 — VID-Caique e Eu x Brian e Nick 4.mp4 | 5 | 5 | 5 | 0 | 0 | 100% |
| V03 — Recording 2026-09-15 - Youtube Video.mp4 | 5 | 15 | 0 | 0 | 5 | 0% |
| Total | 15 | 25 | 10 | 0 | 5 | 66.7% |

V01 times: 2.6, 5.233, 7.867, 10.5, 13.133. V02: 4, 8.033, 12.067, 16.1, 20.133. V03: 5.767, 11.533, 17.3, 23.067, 28.833.

All 15 rejected sub-attempts were PRESENTATION_SKIPPED. There were zero final-run readiness failures, timeouts, source-change failures, cancellations, or decode errors. The batch continued safely after each rejected item.

### Remaining blocker

V03's candidate and first witness have a 1/30-second media interval, but the second witness skips the intervening source frame and yields a 2/30-second interval. This recurred across all three independent attempts at all five fixed timestamps, despite consecutive presentedFrames counts 4, 5, 6 and readyState 4.

| Request | Candidate | First witness | Second witness | Missing source PTS |
|---:|---:|---:|---:|---:|
| 5.767 | 5.766667 | 5.800000 | 5.866667 | 5.833333 |
| 11.533 | 11.500000 | 11.533333 | 11.600000 | 11.566667 |
| 17.300 | 17.300000 | 17.333333 | 17.400000 | 17.366667 |
| 23.067 | 23.066667 | 23.100000 | 23.166667 | 23.133333 |
| 28.833 | 28.800000 | 28.833333 | 28.900000 | 28.866667 |

A read-only ffprobe inspection confirmed each missing timestamp exists in the source stream, between its adjacent 30 fps timestamps. No new pixel comparison, pose measurement, or visual labeling was performed. The remaining failure is in the browser presentation sequence observed during this seek/playback strategy, not absence of those frames from the recording. Its precise decoder/compositor/scheduling cause, including whether the preparation/playback strategy contributes, is unresolved. It must not be declared exclusively an external environment limitation.

Aggregate success improved from 6/14 in 3.0.13b to 10/15, but this is not a uniform per-video improvement: V03's 5.767 and 11.533 had verified in 3.0.13b and now safely reject. The third clip remains an operational regression that blocks a reliability checkpoint. Do not treat 10/10 on the first two clips as the overall rate or discard V03.

## Diagnostics artifact

Native exported file: `research-capture-diagnostics.json`, retained in the local Downloads folder outside the repository.

- 718,628 bytes; authority NONE; 15 timestamp results; 25 sub-attempts.
- Exact UI-preview fingerprint: `fnv1a32-2ee9f449-718628`; saved file matches.
- SHA-256: `23048FA6602C7AFF65E1F0EACB3272F6B5B3B810ED8B5CB700FA4E8723BDE778`.
- Contains complete event histories for all final failures and successes. No images, videos, landmarks, labels, or Shadow assessments.
- Final browser session is retained with the diagnostic preview and research rows. The development session is separately retained for remaining in-memory stabilization history.

## Tests and build

16 new capture tests plus 259 existing tests: **275 passed, 0 failed**. Existing source-transition test was strengthened to require old detection to finish before the new source begins. Focused capture tests were run during stabilization; the final complete run covered research, capture, frozen coherence behavior, phase safety, and biomechanics safety.

Coverage includes initial/sought readiness ordering, successful seek/presentation, missing callback then successful bounded retry, exhausted retries, stale callbacks, source invalidation and new-source fingerprints, reverse/repeated timestamps, serial capture/detection/record, failed item isolation, cancellation without valid rows, timestamp rejection, stage-specific timeout categories, retry provenance, original verification-function equivalence, model hash freeze, and existing product-state isolation assertions.

`npx tsc --noEmit --incremental false` also passed during stabilization. **npm run build: PASS, invoked once after code stabilized. No code changed after that build.** Tests and build logs are in the local temporary directory as `sprint-3.0.13c-tests.txt` and `sprint-3.0.13c-build.txt`.

## Shadow v0 and product freeze

`src/lib/pose-coherence.ts` SHA-256 remains `C0D04A35018F96211BB9CBE3D91EFD27FF56CEE16E5E04A3016FCAA5A9B7B9C7`, byte-for-byte unchanged from the preserved 3.0.13b snapshot. Existing coherence behavior tests passed. No threshold, status, reason, or assessment logic was changed or tuned.

The existing shadow report, coherence tests/evaluator, and pose-research tests also match their saved pre-task hashes. The prior Shadow UI addition remains intact. Product page/detection logic, uploads, extraction, MediaPipe configuration, dedup, tracking, qualification, harvesting, competitor provenance, reacquisition, phases, biomechanics, coaching, APIs, and production routes were not edited. No product-path operational bug was established in this research-only test.

## Files changed by 3.0.13c

1. `src/lib/research-capture.ts` — diagnostic state machine, preparation, bounded retries, cleanup, serial batch helper, optional diagnostic export filename.
2. `src/app/pose-test/RawPoseResearch.tsx` — research batch controls/results, cancellation, source serialization, diagnostic export; preserved Shadow v0 display.
3. `tests/research-capture.test.cjs` — sixteen additional focused tests, simulation extensions, stronger source-transition serialization assertion.
4. `SPRINT-3.0.13c-CAPTURE-REPORT.md` — this report.

Working tree also retains all earlier uncommitted Sprint 3.0.13 work: modified `tests/pose-research.test.cjs`; untracked `SPRINT-3.0.13-SHADOW-REPORT.md`, `src/lib/pose-coherence.ts`, `tests/evaluate-pose-coherence.cjs`, and `tests/pose-coherence.test.cjs`. The research UI and capture tests had prior edits, which were extended rather than discarded.

## Decision and next step

**B — IMPROVED BUT BELOW RELIABILITY TARGET. CORRECTION REQUIRED.** Readiness races are addressed and diagnostics are usable, but the fixed first-three-video gate failed. Keep the five V03 rejections in the denominator. Investigate the missing second-witness source frame during controlled browser playback and compare preparation/playback behavior without weakening verification. Do not rerun broad Shadow v0 labeling until capture reliability is established.

HEAD and branch remain unchanged; working tree is intentionally dirty with preserved and new work. Nothing was committed, pushed, merged, or reset. No videos or research JSON exports were added to the repository.
