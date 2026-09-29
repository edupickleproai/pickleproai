# Blinded raw-pose review (development only)

Open **Open blinded raw-pose review** in `/pose-test` after research captures exist. The full-screen, single-column workspace displays one raw detection over its exact frozen full-frame image. Crop coordinates are mapped for display only; stored coordinates and measurements are not changed.

FIT PLAYER includes surrounding context. FIT FRAME restores the entire frozen frame. ZOOM IN, ZOOM OUT, RESET and pointer dragging affect only the view. Collapsed provenance includes source ID, requested/presented times, frame/input fingerprints, detection source and frame-local pose reference. Pose indices are not player identities.

Choose COHERENT, MALFORMED or UNCERTAIN and explicitly commit it before Reveal Shadow becomes available. The component does not evaluate Shadow before reveal. Once revealed, ordinary label/note editing is disabled. Adjudication requires a revised label and reason, stored alongside the original blinded label; the exported `label` remains the original. Review history is additive to the existing research export. It never enters product evidence.

Previous/Next follow preserved raw-row order. UNLABELED ONLY filters this order. Record status is UNLABELED, LABELED, or REVIEWED (Shadow revealed).

## Preservation limitation and authorized completion

Frozen pixels and raw landmark arrays live only in browser memory. Existing JSON exports contain measurements and provenance, not images or raw coordinate arrays. They cannot restore overlays after a reload. Opening or navigating this workspace does not seek, decode or recapture video.

The original V03 tab did not receive the new workspace through hot reload. The user subsequently authorized recapturing V03 only at the exact frozen timestamps, with reason `REVIEW_PIXELS_UNAVAILABLE_AFTER_WORKSPACE_UPGRADE`. No persistence or session migration was added. The original tab remains untouched; its original detections were never labeled and its Shadow results were never inspected.

The five authorized requests were 5.767, 11.533, 17.300, 23.067 and 28.833 seconds. All passed first-attempt verification. Presented times were 5.766667, 11.500000, 17.300000, 23.066667 and 28.800000 respectively. Every source ID, actual timestamp and frozen-image fingerprint matched the corresponding original capture exactly. This was recovery of review access, not outcome-driven sampling.

## Validation

Fifteen new focused tests plus 304 existing tests passed (319 total). The production build passed once; the generated page omitted the workspace and selector, and research video endpoints returned 404. Build warnings included existing warnings and a non-blocking opener-ref cleanup warning in the review component. No executable changes followed that validation; tests/build were not rerun for the completion task.

At 526 x 895, real V03 screenshots validated ordinary geometry (11.533 LEFT_CROP pass 1), malformed geometry (5.767 FULL_FRAME pass 1), and nearby-player context (11.533 RIGHT_CROP pass 1). FIT FRAME shows the scene; FIT PLAYER and zoom make torso/arms/legs inspectable. Skeletons are distinct and collapsed provenance does not obscure the image. Synthetic checks had already verified pan, navigation, label locking, adjudication and filtering.

All 13 recaptured raw detections were reviewed: 3 COHERENT, 10 MALFORMED, 0 UNCERTAIN. Every label was explicitly committed before its Shadow reveal; the UI exposed neither Shadow results nor active measurements beforehand. No adjudications occurred. Shadow returned NO_OBVIOUS_ANOMALY for all three coherent detections and seven malformed detections; three malformed detections were SUSPICIOUS.

Protocol caveat: initial artifact schema inspection exposed historical measurements for the final original V03 row (28.833 FULL_FRAME pass 3). That review is not claimed fully measurement-blind. Its new label was based on visible limb misalignment; no original Shadow result was inspected. This caveat is retained with the row in the external validation artifact.

The external research artifact replaces active V03 rows with the reviewed recaptures and archives the original unlabeled rows and capture history. Original V01/V02 rows, captures and frozen sampling plan were checked for exact preservation. Native JSON download matched the UI snapshot. No images/raw landmark arrays were persisted, and no research exports were added to the repository.

Decision A — REVIEW WORKSPACE VALIDATED ON REAL VIDEO. Recommend CHECKPOINT. Broad validation remains partial; V04 was not attempted. After checkpoint, resume the frozen plan at V04 5.033s. Model, capture, loader and product behavior remain unchanged.
