# Sprint 3.0.13d — Presentation-Skip Root Cause and Capture Recovery

Date: 2026-09-29. Status: **PASS for the specified 30-point foreground validation**.

Decision: **A — PRESENTATION-SKIP ROOT CAUSE RESOLVED**. Recommendation: **CHECKPOINT**, scoped to the demonstrated foreground capture workflow. Background reliability and every possible timestamp are not claimed. No commit or push performed.

## Root cause and correction

The application-imposed 0.25× witness playback caused a reproducible omission of an intermediate source-frame witness on the September 15 recording in this browser. The sought candidate itself corresponded to the correct source interval. The next two callbacks did not establish contiguous cadence, so rejecting the capture was correct given the evidence available to the verifier.

Controlled experiments, with unchanged requested timestamps and verifier:

- Trace-only instrumentation at 0.25×: 0/5 requests verified, 15 sub-attempts; 12 PRESENTATION_SKIPPED and 3 VIDEO_NOT_READY. The latter callbacks arrived before decode readiness.
- All research playback settings changed to 1×: 5/5 verified on their first attempt.
- Causal reversal at 23.067 seconds: preparation stayed at 1× and only witness playback returned to 0.25×. All three attempts reproduced the same omitted witness.
- Witness playback restored to 1× for the final code and validation.

This isolates witness speed as the operational trigger. It does not establish the browser engine's internal scheduling mechanism or prove that codec profile, GOP length, or CFR alone causes the behavior. No source video was modified or transcoded.

Correction: use native 1× playback for preparation and witnesses. `verifyTiming` is unchanged from the pre-sprint implementation. No tolerance, accepted-frame interval, retry limit, or safety check was relaxed. Complete callback metadata and distinct diagnostic export filenames were added.

## Exact rejection semantics and trace

PRESENTATION_SKIPPED is raised when a sought callback's currentTime differs from the request beyond the existing 0.0001-second precision epsilon, or when timing verification fails. Verification requires finite times, positive local cadence, equal candidate→next and next→following intervals within that epsilon, consecutive presentedFrames counters, the cursor at the request, and the request inside the candidate's interval ending at the next presentation (with the existing precision treatment).

It does not require mediaTime to equal the requested timestamp. It conservatively abstains on nonuniform local witness cadence without authoritative additional frame-boundary evidence.

Representative completed 0.25× witness sequences, in seconds:

| Request | Candidate | Next callback | Following callback | Missing source witness | Required following at 1× |
|---|---:|---:|---:|---:|---:|
| 5.767 | 5.766667 | 5.800000 | 5.866667 | 5.833333 | 5.833333 |
| 11.533 | 11.500000 | 11.533333 | 11.600000 | 11.566667 | 11.566667 |
| 17.300 | 17.300000 | 17.333333 | 17.400000 | 17.366667 | 17.366667 |
| 23.067 | 23.066667 | 23.100000 | 23.166667 | 23.133333 | 23.133333 |
| 28.833 | 28.800000 | 28.833333 | 28.900000 | 28.866667 | 28.866667 |

Each completed failed triple had compositor counts 4,5,6, but intervals about 0.033333 then 0.066667 seconds. Thus this was missing intermediate witness evidence (case D), not a jump past the desired candidate or an exact-T requirement. Whether the omitted decoded frame was actually displayed without a delivered callback is not established by these traces.

At 0.25×, the final callback's expectedDisplayTime was often approximately 117–133 ms ahead of callbackNow despite low decoding processingDuration (roughly 1–3 ms). This is supporting scheduling evidence, not an alternative acceptance rule. The [requestVideoFrameCallback specification](https://wicg.github.io/video-rvfc/) defines presentedFrames in terms of frames submitted for composition; consecutive counters do not enumerate every decoded source frame.

The raw diagnostics retain every received callback, including preparation, with transaction/source/attempt identities, request, cursor, seeked time, callback sequence and wall time, mediaTime, counters, expected/presentation times, processing duration, playback rate, readiness, seeking, paused and visibility states. Representative six-callback fixtures are in the repository; incomplete readiness-failure traces remain in the external raw evidence.

## Source timing and independent decoding

| Source | Nominal / average fps | Timebase | Video duration / frames | Cadence and keyframes |
|---|---|---|---|---|
| September 15 YouTube recording | 30/1 / 30/1 | 1/30000 | 34.6 s / 1038 | Uniform 1/30 s; no duplicate PTS; keyframes every 4.266667 s approximately |
| Caique/Theo | 600/19 / 35325/1178 | 1/600 | 15.706667 s / 471 | Mostly 19/600 s, occasional 38/600 s; keyframes roughly 0.981667 s apart |
| Brian/Nick 4 | 600/19 / 434400/14497 | 1/600 | 24.161667 s / 724 | Same variable-interval pattern; keyframes roughly 0.981667 s apart |

All three are H.264 with no B frames. The problem clip is Main profile; the two comparison clips are Baseline. These differences are descriptive, not a proven explanation for the browser behavior. Decimal PTS rounding produces 0.033333/0.033334 differences on the CFR clip.

FFmpeg independently decoded five neighboring frames at each original problem timestamp, 25 PNGs total. The manifest records their decoded indices and PTS. Each sequence includes the preceding frame, containing frame, and three successors. The table above gives the containing/next boundaries and the missing witness. In particular, 11.533 belongs to the frame starting at 11.500000, not the frame starting at 11.533333. Similarly 28.833 belongs to 28.800000. Selecting the numerically nearest timestamp would be the wrong semantics in those cases.

All five final problem candidates and their two witnesses match the independently enumerated source PTS. All five browser fingerprints match the controlled 1× run. The first two also match the preserved earlier research captures. This task did not perform an exact browser-pixel versus FFmpeg-pixel comparison; independent decoding establishes the source frame sequence and interval boundaries.

Alternative recovery models based on external frame maps or pixel matching were unnecessary: restoring the missing witnesses at native speed permits the existing safe verifier to work. External decoding was evidence for this investigation, not a new production dependency.

## Final validation and all other runs

Validation used the built application on localhost:3004. The user confirmed the task browser pane was foregrounded before the final ladder. Every recorded event reported visibility `visible`.

| Video | Unchanged requested timestamps (seconds) | First-pass | Verified after retry | Rejected |
|---|---|---:|---:|---:|
| September 15 YouTube | 5.767, 11.533, 17.3, 23.067, 28.833 | 5 | 0 | 0 |
| Caique/Theo | 2.6, 5.233, 7.867, 10.5, 13.133 | 4 | 1 | 0 |
| Brian/Nick 4 | 4, 8.033, 12.067, 16.1, 20.133 | 5 | 0 | 0 |
| September 22 Ben John Video 2 | 5.033, 10.1, 15.133, 20.2, 25.233 | 5 | 0 | 0 |
| September 22 Dinks | 2.567, 5.167, 7.767, 10.367, 12.967 | 5 | 0 | 0 |
| September 22 Overhead | 2.433, 4.9, 7.333, 9.8, 12.233 | 5 | 0 | 0 |
| **Total** | **30 requests / 31 sub-attempts** | **29** | **1** | **0** |

Problem gate: 5/5. Regression gate: 10/10. Additional gate: 15/15. First-pass rate 96.7%; final planned verification 100%.

The one final-ladder retry was Caique/Theo at 13.133: candidate/next/following 13.110000,13.141667,13.205000 and counts 4,5,7. The first attempt correctly rejected PRESENTATION_SKIPPED; the second supplied valid witnesses and passed. Three bounded same-time attempts remain appropriate for transient skips/readiness problems. The deterministic quarter-speed failure is removed by the playback correction, not repeated indefinitely or accepted.

Two separate observations are retained, not silently excluded as successes:

1. Preliminary built-app run before foreground confirmation: problem 5/5 first-pass, then Caique/Theo 0/5 with three attempts each. Callbacks were roughly one second apart, sometimes counts 33→62→91, despite `visibilityState=visible`. Across the 15 failed sub-attempts: 14 PRESENTATION_SKIPPED and 1 VIDEO_NOT_READY. Final reasons for all five requests were PRESENTATION_SKIPPED. This is consistent with presentation throttling; visibility alone is not sufficient evidence of foreground scheduling. It remains an environmental operating limitation.
2. Before the planned Overhead batch, an additional request at **0 seconds** appeared in the UI diagnostics. It was not one of the entered five timestamps. Its dispatch cause was not established. All three attempts timed out waiting for the warm sought presentation after an initial frame at zero and a seek to zero. No frame was accepted. The unchanged five timestamps were then explicitly run and passed 5/5 first-pass. Zero-time capture reliability is not claimed or corrected by this sprint.

The complete built-app export therefore contains **41 requests / 54 sub-attempts: 35 verified and 6 rejected**, not an overall 41/41 success claim. Zero-based result indices 0–9 are preliminary; 10–34 and 36–40 are the planned final 30; index 35 is the extra zero-time request. The separate controlled experiment contains 11 requests / 23 sub-attempts.

## Integrity, tests, build and isolation

Accepted frames still require presented-time evidence, synchronous frozen pixels, fingerprint and immutable source/run identity. Stale/cancelled callbacks and source changes retain their guards; no currentTime-only fallback was added. Rejected attempts do not create records. Existing transaction, cancellation, batch-order, source, frozen-input and product-isolation tests pass. Labels remain UNLABELED; no broad Shadow labeling was performed.

- Focused capture/presentation tests: **45 passed**.
- Full selected research/coherence/safety suite: **287 passed, 0 failed** — **275 existing + 12 new**.
- New tests: 2 capture metadata/native-rate tests and 10 presentation tests covering containing intervals, boundary selection, actual skip fixtures, valid native-rate fixtures, wrong counters, nonuniform cadence, duplicates/reversed timestamps, stale PTS, complete callback order, and future expected display time.
- Build: **PASS**, one invocation after stabilization. No code changed after the passed build; only this report was subsequently added.
- Shadow v0 unchanged, SHA256 `C0D04A35018F96211BB9CBE3D91EFD27FF56CEE16E5E04A3016FCAA5A9B7B9C7`.
- Preserved Shadow report, evaluator, coherence tests and pose-research tests match the saved pre-validation hashes.
- No changes to MediaPipe, tracking, qualification, reacquisition, phases, biomechanics, coaching or production routes. The only application importer of research-capture is RawPoseResearch.

## Evidence and files

External evidence folder: `Sprint-3.0.13d` in the local Research archive outside the repository. The private absolute path is omitted from this repository report.

- `controlled-playback-comparison.json`: full controlled 0.25× / 1× / reversal experiments.
- `source-timing.json`: stream and frame timing for the three original clips.
- `independent-frames/manifest.json` and 25 PNGs: decoded neighboring source sequence.
- `validation-complete.json`: all 41 built-app requests, including both separately reported failure groups. Native download is 1,899,391 bytes, matches DOM preview FNV32 `d213b5ea`; SHA256 `6386098bedb65bbfe86efa216ed436bab1afe5e17df7f357453b858495ea8ce2`.

Sprint 3.0.13d files changed/added:

- `src/lib/research-capture.ts`: native playback and complete presentation telemetry.
- `src/app/pose-test/RawPoseResearch.tsx`: distinct diagnostic filenames.
- `tests/research-capture.test.cjs`: two focused tests and supporting fake metadata.
- `tests/research-presentation.test.cjs`: ten deterministic tests.
- `tests/fixtures/research-presentation-traces.cjs`: representative trace metadata and source PTS.
- `SPRINT-3.0.13d-CAPTURE-RECOVERY-REPORT.md`: this report.

Earlier uncommitted Sprint 3.0.13/13c files remain preserved. Research exports and decoded images are outside the repository; only the small deterministic timing fixture is included as test source.

Git: branch `feature/player-tracking`; HEAD `c033a7fc8fe5911c91b5792e5bac6d33ce488e0f`; working tree intentionally dirty with prior and current sprint work, unstaged. No commit, push or branch change.

Next step after checkpoint approval: rerun the frozen Sprint 3.0.13b broad Shadow validation with the pane foregrounded. It was not run in this task.
