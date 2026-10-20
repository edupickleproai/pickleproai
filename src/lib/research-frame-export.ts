import { imageFingerprint, verifyTiming, type FrozenResearchFrame } from './research-capture'

export type FrameExportInput = {
  videoId: string
  sourceId: string
  frame: FrozenResearchFrame
}

function developmentOnly() {
  if (process.env.NODE_ENV !== 'development') throw new Error('Research frame export is development-only.')
}

// Decode the existing encoded bytes. Never draw to canvas or re-encode the image.
export async function prepareVerifiedFrameExport(input: FrameExportInput) {
  developmentOnly()
  const { frame, videoId, sourceId } = input
  if (!videoId.trim() || !sourceId.trim() || !frame.frameId) throw new Error('Missing capture provenance.')
  const t = frame.timing
  if (t.integrity !== 'VERIFIED' || t.requestedTime !== frame.timestampSeconds ||
      t.actualTime !== t.presentation.mediaTime || t.followingPresentations.length < 2)
    throw new Error('Only verified captures can be exported.')
  verifyTiming(t.requestedTime, t.presentation, t.followingPresentations[0], t.followingPresentations[1])
  if (!t.attempts?.length || !t.attempts.some(a => a.outcome === 'VERIFIED') ||
      t.attempts.some(a => a.sourceId !== sourceId || a.transactionId !== frame.frameId))
    throw new Error('Capture transaction/source provenance mismatch.')
  if (imageFingerprint(frame.imageDataUrl) !== frame.imageFingerprint)
    throw new Error('Captured image fingerprint mismatch.')
  const encoded = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(frame.imageDataUrl)?.[1]
  if (!encoded) throw new Error('Original captured JPEG bytes unavailable.')
  const binary = atob(encoded)
  if (btoa(binary) !== encoded) throw new Error('Invalid JPEG base64 encoding.')
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217)
    throw new Error('Invalid JPEG envelope.')
  const jpeg = new Blob([bytes], { type: 'image/jpeg' })
  const decoded = await createImageBitmap(jpeg, { imageOrientation: 'none', colorSpaceConversion: 'none' })
  try {
    if (decoded.width !== frame.width || decoded.height !== frame.height) throw new Error('JPEG dimensions differ from capture.')
  } finally { decoded.close() }
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  const provenance = {
    schemaVersion: 1, authority: 'NONE', videoId, sourceId,
    captureTransactionId: frame.frameId, requestedTimestamp: t.requestedTime,
    presentedTimestamp: t.actualTime, captureFingerprint: frame.imageFingerprint,
    width: frame.width, height: frame.height, timing: t,
    image: { mime: 'image/jpeg', sha256, byteLength: bytes.length,
      originalBytes: true, method: 'Base64 decode of original frozen imageDataUrl; no re-encoding' },
  }
  return { jpeg, provenance: new Blob([JSON.stringify(provenance, null, 2)], { type: 'application/json' }),
    filename: `research-frame-${sha256}` }
}

// Only called by explicit UI clicks. One download per action avoids multi-download blocking.
export function downloadVerifiedFrameArtifact(blob: Blob, filename: string, trustedClick: boolean) {
  developmentOnly()
  if (!trustedClick || !navigator.userActivation?.isActive) throw new Error('Use an explicit export button click.')
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  try { anchor.click() } finally {
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
