// Development-only capture diagnostics. Not imported by product extraction/tracking.
export type Presentation = {
  mediaTime: number; presentedFrames: number; expectedDisplayTime: number
  currentTime: number; elapsedMs: number
}
export type CaptureTiming = {
  requestedTime: number; actualTime: number; differenceSeconds: number
  observedFrameCadence: number; currentTimeAtDraw: number; seekedCurrentTime: number | null
  seekedElapsedMs: number | null; presentation: Presentation
  followingPresentations: Presentation[]; integrity: 'VERIFIED'
}
export type FrozenResearchFrame = Readonly<{
  frameId: string; timestampSeconds: number; imageDataUrl: string
  width: number; height: number; imageFingerprint: string; timing: CaptureTiming
}>

// Diagnostic checksum, not a cryptographic identifier or physical-player identity.
export function imageFingerprint(image: string): string {
  let hash = 2166136261
  for (let i = 0; i < image.length; i++) hash = Math.imul(hash ^ image.charCodeAt(i), 16777619)
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}-${image.length}`
}

export function verifyTiming(requested: number, frame: Presentation, next: Presentation, following: Presentation) {
  const cadence = following.mediaTime - next.mediaTime
  const firstInterval = next.mediaTime - frame.mediaTime
  const epsilon = 0.0001 // timestamp precision only; not a pose/coherence threshold
  if (![requested, frame.mediaTime, next.mediaTime, following.mediaTime, frame.currentTime].every(Number.isFinite)
    || cadence <= 0 || Math.abs(firstInterval - cadence) > epsilon
    || next.presentedFrames !== frame.presentedFrames + 1 || following.presentedFrames !== next.presentedFrames + 1
    || Math.abs(frame.currentTime - requested) > epsilon
    || requested < frame.mediaTime - epsilon || requested >= next.mediaTime - epsilon) {
    throw new Error(`UNVERIFIED capture: requested ${requested}s; presented ${frame.mediaTime}, ${next.mediaTime}, ${following.mediaTime}s (frames ${frame.presentedFrames}, ${next.presentedFrames}, ${following.presentedFrames}; cursor ${frame.currentTime}s). Frame cadence/coverage not established. No research record created.`)
  }
  return cadence
}

export class ResearchTransactions {
  private serial = 0
  private active: number | null = null
  begin() { if (this.active !== null) return null; this.active = ++this.serial; return this.active }
  current(token: number) { return this.active === token }
  cancel() { this.active = null; this.serial++ }
  finish(token: number) { if (this.current(token)) this.active = null }
}

export async function captureResearchFrame(url: string, requestedTime: number, frameId: string, signal: AbortSignal): Promise<FrozenResearchFrame> {
  if (!Number.isFinite(requestedTime) || requestedTime < 0) throw new Error('Enter a valid timestamp.')
  const video = document.createElement('video')
  video.muted = true; video.playsInline = true; video.preload = 'auto'
  if (typeof video.requestVideoFrameCallback !== 'function') throw new Error('UNVERIFIED: this browser cannot report presented frame timestamps. No research record created.')
  const start = performance.now()
  let phase = 'load', lastPresentedTime: number | null = null
  const disposers = new Set<() => void>()
  const wait = <T>(subscribe: (resolve: (v: T) => void, reject: (e: Error) => void) => () => void): Promise<T> => new Promise((resolve, reject) => {
    let unsubscribe = () => {}
    let settled = false
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); video.removeEventListener('error', failed); unsubscribe(); disposers.delete(aborted) }
    const done = (value: T) => { if (settled) return; settled = true; cleanup(); resolve(value) }
    const bad = (error: Error) => { if (settled) return; settled = true; cleanup(); reject(error) }
    const aborted = () => bad(new Error('Research capture cancelled. No research record created.'))
    const failed = () => bad(new Error('Research video load/seek failed. No research record created.'))
    const timer = setTimeout(() => bad(new Error(`UNVERIFIED: ${phase} timed out (requested ${requestedTime}s; cursor ${video.currentTime}s; last presented ${lastPresentedTime}; seeking ${video.seeking}; ready ${video.readyState}). No research record created.`)), 15000)
    signal.addEventListener('abort', aborted, { once: true }); video.addEventListener('error', failed, { once: true }); disposers.add(aborted)
    if (signal.aborted) { aborted(); return }
    unsubscribe = subscribe(done, bad)
  })
  const event = (name: string) => wait<void>(resolve => {
    const listener = () => resolve()
    video.addEventListener(name, listener, { once: true })
    return () => video.removeEventListener(name, listener)
  })
  const canvas = document.createElement('canvas')
  let frozenImage = ''
  const presented = (freeze: boolean, requireSeek: boolean) => wait<Presentation>((resolve, reject) => {
    let handle: number
    const callback: VideoFrameRequestCallback = (_, m) => {
      lastPresentedTime = m.mediaTime
      // Presentation can precede the seeked event. Freeze here and await BOTH below.
      if (video.readyState < 2 || (requireSeek && Math.abs(video.currentTime - requestedTime) > 0.0001)) {
        handle = video.requestVideoFrameCallback(callback); return
      }
      try {
        const p = { mediaTime: m.mediaTime, presentedFrames: m.presentedFrames, expectedDisplayTime: m.expectedDisplayTime, currentTime: video.currentTime, elapsedMs: performance.now() - start }
        if (freeze) {
          const scale = Math.min(1, 1280 / video.videoWidth)
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
          const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable.')
          // Freeze INSIDE the callback identifying this frame, before playback or another seek.
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          frozenImage = canvas.toDataURL('image/jpeg', .92)
        }
        resolve(p)
      } catch (e) { reject(e instanceof Error ? e : new Error('Research draw failed.')) }
    }
    handle = video.requestVideoFrameCallback(callback)
    return () => video.cancelVideoFrameCallback(handle)
  })
  try {
    // Drain the initial presentation before seeking, so it cannot satisfy a later seek.
    const loaded = event('loadeddata')
    const initial = presented(requestedTime === 0, false)
    video.src = url; video.load()
    const [, initialFrame] = await Promise.all([loaded, initial])
    if (!Number.isFinite(video.duration) || requestedTime >= video.duration) throw new Error('Timestamp must be before video end.')
    let frame = initialFrame
    let seekedCurrentTime: number | null = null, seekedElapsedMs: number | null = null
    if (requestedTime !== 0) {
      phase = 'seek/presentation'
      const sought = event('seeked').then(() => { seekedCurrentTime = video.currentTime; seekedElapsedMs = performance.now() - start })
      const presentation = presented(true, true)
      video.currentTime = requestedTime
      ;[, frame] = await Promise.all([sought, presentation])
    }
    // Two subsequent consecutive presentations establish cadence, rather than assuming 30 fps.
    // The candidate image is already frozen. Playback never changes that image.
    phase = 'following presentations'
    const nextPromise = presented(false, false)
    const nextAndFollowing = nextPromise.then(async next => ({ next, following: await presented(false, false) }))
    const [, { next, following }] = await Promise.all([video.play(), nextAndFollowing])
    video.pause()
    const observedFrameCadence = verifyTiming(requestedTime, frame, next, following)
    if (signal.aborted) throw new Error('Research capture cancelled.')
    return Object.freeze({ frameId, timestampSeconds: requestedTime, imageDataUrl: frozenImage, width: canvas.width, height: canvas.height, imageFingerprint: imageFingerprint(frozenImage),
      timing: Object.freeze({ requestedTime, actualTime: frame.mediaTime, differenceSeconds: frame.mediaTime - requestedTime, observedFrameCadence, currentTimeAtDraw: frame.currentTime, seekedCurrentTime, seekedElapsedMs, presentation: frame, followingPresentations: [next, following], integrity: 'VERIFIED' as const }) })
  } finally {
    for (const dispose of [...disposers]) dispose()
    video.pause(); video.removeAttribute('src'); video.load()
  }
}

export function assertFrozenInput(frame: FrozenResearchFrame, detectorSource: string) {
  if (detectorSource !== frame.imageDataUrl || imageFingerprint(detectorSource) !== frame.imageFingerprint) throw new Error('Detector input does not match frozen research frame. Capture discarded.')
}

// Explicit allowlist: never serialize captures, detector traces or arbitrary row properties.
export function researchExport(rows: Array<Record<string, any>>) {
  const keys = ['id','captureId','video','fingerprint','timestamp','requestedTime','actualTime','frameId','frameFingerprint','detectorInputFingerprint','sourceImageFingerprint','timing','source','passPose','poseIndex','stage','label','note','measurements']
  return JSON.stringify({ schemaVersion: 2, authority: 'NONE', rows: rows.map(row => Object.fromEntries(keys.map(key => [key, row[key]]))) }, null, 2)
}

export function downloadResearchJson(json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'pose-research.json'
  document.body.appendChild(anchor); anchor.click(); anchor.remove()
  // Let the browser start consuming the URL before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
