# Development research video loading

Set `PICKLEPRO_RESEARCH_VIDEO_DIR` to the absolute authorized video directory in
`.env.development.local` (already ignored). Restart `npm run dev -- --hostname 127.0.0.1`.
Keep this value local; do not put private paths in source or public environment variables.

In `/pose-test`, choose **Research video source** under Raw Pose Research. The
research preview shows filename, duration, dimensions and source ID after metadata
loads. The ordinary uploaded video and all product analysis state remain separate.
Choose **Use uploaded video** to return to the existing research upload source.

The read-only `/pose-test/research-videos` index lists immediate regular `.mp4`,
`.m4v`, `.mov` and `.webm` files. The browser must support the file's actual codec.
No recursion, path input, filesystem writes, symlinks or arbitrary file endpoints.
Routes return 404 unless `NODE_ENV=development`, an absolute directory is configured,
and the request uses a loopback host. Cross-origin requests are rejected. The index
exposes only filenames, opaque IDs and same-origin URLs, never filesystem paths.
The configured directory is explicitly trusted; do not place unrelated private videos
there or edit its files during a capture session.

IDs are SHA-256 of filename, byte length and modification time: stable across switches
and restarts, changing when the file version changes. They are source identities,
not content checksums. Existing frozen-frame fingerprints remain the pixel evidence.
Capture rows use the selected ID as `fingerprint`; capture attempts use it as `sourceId`.

The stream route uses a read-only file stream. Full requests return 200; one valid
byte range returns 206, including open-ended and suffix ranges. MIME, Content-Length
and Accept-Ranges are provided; partial responses add Content-Range. Unsupported,
multiple or unsatisfiable ranges return 416 and `Content-Range: bytes */<size>`.
HEAD provides the same headers without a body. Responses are not cached.

Switching invalidates pending transactions immediately. Capture remains unavailable
until new metadata loads; old metadata callbacks cannot re-enable an earlier source.
Completed rows/labels remain attached to their original identities. Timestamp, batch
input, selected overlay and export preview reset. A pending detection must finish
before another capture starts; its stale result cannot publish rows.

This loader does not change capture verification or Shadow v0. It does not label data
or resume the frozen Sprint 3.0.13e plan. After an approved checkpoint, that separate
validation resumes at V03, 5.767 seconds; completed V01/V02 need not be repeated.

## Sprint 3.0.13f validation (2026-09-29)

Browser smoke sequence used only the new selector, with no file picker or human
labels. Correct filenames, visible content and fresh metadata were checked on each
switch. All four final captures verified on attempt 1; each source ID appeared in
capture-attempt provenance. Completed rows remained associated with their original
videos. Product upload remained empty and product phase results remained unchanged.

| Sequence | Source | Duration | Requested → presented | Frozen frame fingerprint |
| --- | --- | --- | --- | --- |
| 1 | V01: VID-Caique e Theo.mp4 | 15.766349s | 2.600 → 2.596667s | fnv1a32-d1fa2f15-81679 |
| 2 | V02: VID-Caique e Eu x Brian e Nick 4.mp4 | 24.195193s | 4.000 → 3.990000s | fnv1a32-610a7c0f-118047 |
| 3 | V03: Recording 2026-09-15 - Youtube Video.mp4 | 34.600000s | 5.767 → 5.766667s | fnv1a32-359a5526-268091 |
| 4 | V01 again | 15.766349s | 2.600 → 2.596667s | fnv1a32-d1fa2f15-81679 |

Source IDs (unchanged when returning to V01):

- V01: `9b4ac3e03d1626f870555956ad03710e7ebabf70bb297314e37c392a9f454620`
- V02: `222099196a66df279909e64cea023ccb46ed061e0f13adb6a7f8cbba590ddf1a`
- V03: `0c02e4f1e1a4a308828ec3671d9d5e9d6df14f199ce386b18ba2c9fac227eed3`

During integration, a relative source URL correctly triggered the frozen harness's
source-change guard. Resolving it against Next's internal host also exposed a
localhost/127.0.0.1 mismatch. The selector now resolves the URL against the browser's
own origin. Regression tests cover this; the harness was not changed.

Final automated suite: 304 passed (17 new, 287 existing), no failures or skips.
This covers loader restrictions, streaming/ranges, stale metadata and detection,
new-source provenance, frozen capture/model/product boundaries, and existing phase
and biomechanics behavior. No broad validation data or labels were collected.

The single production build passed. Existing page lint warnings remain, plus a
non-blocking hook warning about the selector's intentionally live generation ref
in cleanup. No code changed after this build. With the directory explicitly supplied
to the built production server, both index and stream returned 404, and the production
page omitted the selector. The development server is bound to loopback only.
