import { imageFingerprint } from './research-capture'
import { prepareVerifiedFrameExport, type FrameExportInput } from './research-frame-export'

export type EvidenceTrace = {
  sourceImage: string
  records: Array<{
    poseIndex: number
    raw: { source: string; passPose: number; input: string; width: number; height: number; sx: number; fullWidth: number; landmarks: unknown[] }
    final: { poseIndex: number; landmarks: unknown[] }
    retained: boolean; suppressedBy: number | null
    overlaps: Array<{ poseIndex: number; iou: number }>
  }>
}
type SpecialValue = { path: string; kind: string }
const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message) }
const sha = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')

// JSON numbers round-trip finite JS doubles. Explicit sidecars preserve values JSON cannot represent.
function snapshot(value: unknown, path: string, special: SpecialValue[]): any {
  if (value === undefined || (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0)))) {
    special.push({ path, kind: value === undefined ? 'undefined' : Object.is(value, -0) ? '-0' : String(value) })
    return null
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value
  if (Array.isArray(value)) return Array.from(value, (v, i) => snapshot(v, `${path}/${i}`, special))
  check(typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'Unsupported evidence value')
  return Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, snapshot(v, `${path}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`, special)]))
}

export function validatePoseEvidence(value: any) {
  check(value?.schema === 'picklepro.research.complete-pose-evidence' && value.schemaVersion === 1 && value.authority === 'NONE', 'Invalid evidence schema')
  check(value.capture?.timing?.integrity === 'VERIFIED' && value.capture.captureTransactionId && value.capture.sourceId, 'Missing verified provenance')
  check(/^[a-f0-9]{64}$/.test(value.images?.jpeg?.sha256) && value.images.jpeg.originalBytes === true, 'Missing JPEG integrity')
  check(Array.isArray(value.hypotheses) && value.candidateCount === value.hypotheses.length && Array.isArray(value.specialValues), 'Invalid evidence counts')
  const ids = new Set()
  value.hypotheses.forEach((h: any, i: number) => {
    check(h.order === i && typeof h.candidateId === 'string' && !ids.has(h.candidateId), 'Invalid candidate order/identity'); ids.add(h.candidateId)
    check(h.captureTransactionId === value.capture.captureTransactionId && h.frameFingerprint === value.capture.captureFingerprint, 'Candidate capture mismatch')
    check(Array.isArray(h.rawLandmarks) && h.landmarkCount === h.rawLandmarks.length && Array.isArray(h.mappedCandidate?.landmarks), 'Invalid landmark arrays')
    check(['FULL_FRAME', 'LEFT_CROP', 'RIGHT_CROP'].includes(h.source) && Number.isInteger(h.passPose) && h.passPose > 0, 'Invalid source/pass')
    check(typeof h.deduplication?.retained === 'boolean' && Array.isArray(h.deduplication.overlaps) && h.coordinateBasis && h.mapping && h.cropBounds, 'Incomplete hypothesis provenance')
  })
  for (const entry of value.specialValues) {
    check(typeof entry.path === 'string' && entry.path.startsWith('/hypotheses/') && ['undefined', '-0', 'NaN', 'Infinity', '-Infinity'].includes(entry.kind), 'Invalid special value')
    const parts = entry.path.slice(1).split('/').map((s: string) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    let target = value
    for (const part of parts) { check(target !== null && Object.prototype.hasOwnProperty.call(target, part), 'Missing special-value path'); target = target[part] }
    check(target === null, 'Special-value placeholder changed')
  }
  return value
}

export async function prepareCompletePoseEvidence(input: FrameExportInput, trace: EvidenceTrace) {
  if (process.env.NODE_ENV !== 'development') throw new Error('Complete pose evidence is development-only.')
  // Reuse the verified frame byte/provenance checks; this performs no pose inference.
  const image = await prepareVerifiedFrameExport(input)
  const capture = JSON.parse(await image.provenance.text())
  check(trace.sourceImage === input.frame.imageDataUrl && Array.isArray(trace.records), 'Detector input/capture mismatch')
  const specialValues: SpecialValue[] = []
  const hypotheses = trace.records.map((record, order) => {
    const r = record.raw
    check(Number.isInteger(record.poseIndex) && record.poseIndex > 0 && record.final.poseIndex === record.poseIndex, 'Candidate identity mismatch')
    check(Array.isArray(r.landmarks) && Array.isArray(record.final.landmarks), 'Complete landmark arrays unavailable')
    check(r.fullWidth === input.frame.width && r.height === input.frame.height && Number.isInteger(r.width) && r.width > 0 && Number.isInteger(r.sx) && r.sx >= 0 && r.sx + r.width <= r.fullWidth, 'Unverifiable crop geometry')
    return snapshot({
      order, candidateId: JSON.stringify([input.sourceId, input.frame.frameId, r.source, r.passPose, 'raw']),
      frameLocalIndex: record.poseIndex, captureTransactionId: input.frame.frameId,
      frameFingerprint: input.frame.imageFingerprint, source: r.source, passPose: r.passPose,
      rawInputFingerprint: imageFingerprint(r.input), landmarkCount: r.landmarks.length,
      rawLandmarks: r.landmarks,
      coordinateBasis: { xy: 'Normalized to original detector input; not clamped', z: 'Original detector-input normalized z when present; not remapped', absentFields: 'UNKNOWN; omitted fields remain omitted', world: 'mappedCandidate.worldLandmarks, if present, are original detector world coordinates; crop and full-frame world spaces are not asserted comparable' },
      cropBounds: { x: r.sx, y: 0, width: r.width, height: r.height, fullWidth: r.fullWidth, fullHeight: input.frame.height, basis: 'source-frame pixels; existing horizontal crop geometry' },
      mapping: { x: '(raw.x * inputWidth + offsetX) / fullWidth', y: 'raw.y', z: 'No new mapping; exported mapped candidate is the existing pipeline result', appliedByExport: false },
      mappedCandidate: record.final,
      deduplication: { retained: record.retained, suppressedBy: record.suppressedBy, overlaps: record.overlaps },
    }, `/hypotheses/${order}`, specialValues)
  })
  const value = validatePoseEvidence({ schema: 'picklepro.research.complete-pose-evidence', schemaVersion: 1, authority: 'NONE',
    capture, images: { jpeg: capture.image, png: null, pngStatus: 'UNKNOWN: external derived PNG is not held by this capture session' },
    candidateCount: hypotheses.length, hypotheses, specialValues,
    serialization: 'UTF-8 JSON; finite JS numeric values round-trip without rounding. Special values use null plus JSON Pointer/type sidecar. Explicit null stays null; absent fields stay absent. No coordinates computed or transformed.',
  })
  const json = JSON.stringify(value, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const sha256 = await sha(await blob.arrayBuffer())
  return { json, blob, sha256, filename: `research-pose-evidence-${sha256}.json` }
}
