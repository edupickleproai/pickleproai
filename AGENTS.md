# PicklePro.AI Development Instructions

## Project

PicklePro.AI is an AI-powered pickleball coaching platform built with Next.js, React, TypeScript, OpenAI integrations, FFmpeg, and MediaPipe.

## General Development Rules

- Inspect the existing implementation before making changes.
- Preserve working functionality unless the task explicitly requires changing it.
- Prefer small, reversible changes.
- Do not refactor unrelated code.
- Do not modify production routes unless explicitly requested.
- Run `npm run build` after code changes.
- Report all changed files and the build result.
- Do not commit or push unless explicitly instructed.

## Git Safety

- Never run `git commit`, `git push`, `git reset --hard`, `git clean`, or destructive git commands unless explicitly authorized.
- Work on the current branch unless explicitly instructed otherwise.
- Preserve all existing uncommitted work.

## Current Development Area

The current active development area is:

`src/app/pose-test`

This is a development/debug environment for player tracking and biomechanics.

The production video-analysis flow currently lives separately under:

`src/app/video-review`

Do not modify `/video-review` unless explicitly instructed.

## Player Tracking

- TARGET\_A represents the selected physical player.
- MediaPipe pose index is per-image and must never be treated as player identity.
- Preserve the existing TARGET\_A matching logic unless explicitly instructed.
- Preserve multi-pass detection and crop fallback unless explicitly instructed.
- Do not assume Pose #1 / Pose #2 / Pose #3 remains the same person across frames.

## Detection

Current multi-person detection may use:

- FULL\_FRAME
- LEFT\_CROP
- RIGHT\_CROP

Crop detections are remapped to full-frame 2D normalized coordinates.

Do not assume crop-derived worldLandmarks are directly comparable to full-frame worldLandmarks.

## Biomechanics

Biomechanics currently includes:

- knee flexion
- torso lean
- stance width
- shoulder tilt

Production-safe coaching must distinguish trusted metrics from experimental metrics.

Current safety principles:

### Knee Flexion

- Prefer IMAGE-space knee flexion for cross-phase coaching.
- Require sufficient hip/knee/ankle landmark visibility.
- World knee metrics from crop detections are experimental/debug-only.

### Torso Lean

- Prefer normalized IMAGE-space torso lean magnitude for coaching.
- Crop-derived world torso metrics are debug-only for cross-phase analysis.

### Stance Width

- Orientation-sensitive.
- Use for coaching only when orientation reliability is high.
- Crop-derived world stance metrics remain experimental.

### Shoulder Tilt

- Preserve signed value for diagnostics.
- Prefer absolute magnitude for coaching.
- Signed cross-phase comparisons are unreliable when body orientation changes.

## Coaching Eligibility

Downstream AI coaching should only receive metrics marked coachingEligible.

Never generate a numeric movement comparison when:

- one or both metrics are not coaching eligible
- sources are incompatible
- reliability is insufficient

Show N/A or NOT RELIABLE instead.

## Debug vs Product

Keep a clear separation between:

### Research / Debug

May include:

- raw landmarks
- worldLandmarks
- crop/full-frame comparisons
- signed shoulder tilt
- experimental metrics
- detailed diagnostic JSON

### Product / Coaching

Should include only:

- compatible
- reliable
- coaching-eligible
  metrics.

Avoid false precision.

## Validation

After meaningful changes:

1. inspect the affected files
2. run `npm run build`
3. report:
   - files changed
   - key implementation changes
   - validation performed
   - build result
   - remaining risks or unresolved issues

Do not commit or push.
