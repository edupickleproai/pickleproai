# Independent person evidence research (Sprint 3.0.15a)

Development-only workspace: `/pose-test/person-evidence`. Production returns 404. The separate workspace has no callbacks into the pose page or product state. It does not run Pose or Shadow v0. No product route, pose acceptance, identity, tracking, acquisition, phase or coaching logic consumes these results.

## Fixed experiment

- Installed API: `@mediapipe/tasks-vision@1.0.1`, `ObjectDetector.createFromOptions`, `detect(HTMLImageElement)`.
- Model: official EfficientDet-Lite0 int8 version 1, 320 × 320 input.
- Retrieval: https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite
- Bytes: 4,602,795. SHA-256: `0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb`.
- CPU delegate, IMAGE mode, scoreThreshold 0.10, maxResults -1, categoryAllowlist `person`.
- Three identical-image repetitions; export first detection list and all three inference timings. Retain every API-returned person box; the model/API's own postprocessing still applies. No additional threshold, suppression or clipping. Settings selected before outputs, not tuned per frame.

The official TensorFlow publisher's [Lite0 int8 v1 model card](https://www.kaggle.com/models/tensorflow/efficientdet/tfLite/lite0-int8/1) lists Apache 2.0 under the selected variation. This is model-specific evidence, not merely the MediaPipe repository license. [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0) allows use and redistribution subject to its license/notice conditions. The official MediaPipe packaged model is obtained from Google's versioned distribution; its exact bytes are pinned above. No binary is redistributed in this repository. Keep a local research copy outside Git; select it in the workspace. Runtime does not download a model from a third party. WASM is served read-only from the already installed matching package, only in development, with a fixed filename allowlist and loopback/same-origin checks.

[Official API guide](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/web_js) and [model guide](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector) were checked for the spike. No dependency upgrade was required.

## External session input

Load a JSON with `annotationsFrozenAt`, `annotationsSha256` and up to 40 `frames`. Each frame includes `frameKey`, development `video` ID, `width`, `height`, PNG `imageDataUrl`, `pngSha256`, `annotations`, and unchanged archived `candidates`. The development allowlist is V03/V04/V05/V07/V08/V09/V11/V12. Held-out data must never be loaded under another ID. The allowlist is a workflow guard, not a mechanism to authenticate image provenance.

Annotations have frame-local `id`, normalized visible `box: {x,y,width,height}`, confidence and description. Freeze these from clean images before inference and preserve the external freeze hash. They are approximate visible regions, not amodal body extents. Record occlusion, small/far, overlap, unresolved regions and reviewer provenance externally. Assistant annotation must not be presented as independent human ground truth.

Candidates have stable archived `id`, `source`, `label` and `joints`. A compact `[{index,x,y}, ...]` list is converted by explicit anatomical index; a normalized joint map is accepted directly. Crop coordinates must already have been mapped to full-frame coordinates. `mapCropPoint` documents/tests that mapping; do not remap archived full-frame points a second time. No coordinates, labels or pose hypotheses are regenerated.

The workspace validates image hashes and dimensions, pins the model hash, and retains incremental completed results on errors. Source controls are locked during a run. It closes the detector afterward. The export contains runtime configuration, initialization/inference times, person boxes, and descriptive pose relationships. Preserve annotation and source archives separately; exports do not embed images.

Cyan dashed boxes are frozen annotations, orange boxes detector outputs, magenta lines archived poses. Frame/person/box IDs are local; they are not tracking identities. All detector boxes remain visible, including duplicates and background detections. Dense spectator regions can be unresolved rather than falsely counted as background errors.

## Interpretation and limitations

Relationships report torso-center containment, shoulder/hip membership, core fraction inside, arm/leg points outside, memberships in other boxes, and core-landmark bbox IoU. There is no acceptance/rejection decision or learned/optimized threshold. A limb outside a box is not automatically malformed; no person box is not automatically a phantom. Boxes overlap, may cover empty space or parts of multiple bodies, and cannot establish anatomical ownership within their overlap. Coherent and malformed candidates can both fit one box completely.

Inference is synchronous on the UI thread, suitable only for this bounded sampled-frame experiment. Initialization includes dynamic package import and local WASM/model initialization, excludes user file selection/model hashing. Per-inference timing excludes image decoding, normalization of outputs, visualization and pose relationship calculations. The first call is cold; report warm samples separately. No production end-to-end or crop-pose performance claim is supported.

Focused checks: `node --test tests/research-person-evidence.test.cjs`. Build: `npm run build`. Research outputs, videos, model binary, temporary full-frame PNGs and private paths remain outside Git.
