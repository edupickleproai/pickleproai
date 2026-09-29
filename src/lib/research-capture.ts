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
  attempts?: CaptureAttempt[]
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

export type CaptureStage = 'IDLE' | 'PREPARING_VIDEO' | 'SEEKING' | 'WAITING_FOR_PRESENTATION' | 'FREEZING_FRAME' | 'VERIFYING' | 'READY_FOR_DETECTION' | 'COMPLETE' | 'FAILED' | 'CANCELLED'
export type CaptureFailure = 'SEEK_TIMEOUT' | 'PRESENTATION_TIMEOUT' | 'PRESENTATION_SKIPPED' | 'STALE_TRANSACTION' | 'VIDEO_NOT_READY' | 'SOURCE_CHANGE' | 'DECODE_FAILURE' | 'OTHER'
export type CaptureEvent = {
  event: string; stage: CaptureStage; elapsedMs: number; stageElapsedMs: number
  readyState: number; currentTime: number; paused: boolean; seeking: boolean
  cancelled: boolean; sourceChanged: boolean; visibility?: string; playbackRate?: number; mediaTime?: number; presentedFrames?: number
  callbackSequence?: number; callbackNow?: number; wallClockMs?: number; expectedDisplayTime?: number; presentationTime?: number; processingDuration?: number; seekedTime?: number | null; witness?: string
}
export type CaptureAttempt = {
  transactionId: string; sourceId: string; attemptId: string; elementId: string; requestedTime: number
  state: CaptureStage; outcome: 'VERIFIED' | 'REJECTED'; reason?: CaptureFailure; message?: string
  events: CaptureEvent[]; elapsedMs: number
}
export class ResearchCaptureError extends Error {
  constructor(public reason: CaptureFailure, message: string, public attempts: CaptureAttempt[] = []) {
    super(`UNVERIFIED ${reason}: ${message}`); this.name = 'ResearchCaptureError'
  }
}
type CaptureOptions = { sourceId?: string; onAttempt?: (attempt: CaptureAttempt) => void }
const MAX_CAPTURE_ATTEMPTS = 3
const STAGE_TIMEOUT_MS = 15000

// Each sub-attempt owns its decoder, callback handles, timers, and immutable source identity.
// Initial presentation is drained independently of readyState: rVFC can precede loadeddata.
async function captureAttempt(url: string, requestedTime: number, frameId: string, signal: AbortSignal, diagnostic: CaptureAttempt): Promise<FrozenResearchFrame> {
  const video = document.createElement('video')
  video.muted = true; video.playsInline = true; video.preload = 'auto'
  // Use the native media clock. On the CFR 30 fps regression clip, 0.25x witness
  // playback deterministically omitted a source presentation even with consecutive
  // compositor counts; 1x restores the witnesses without relaxing verification.
  video.defaultPlaybackRate = 1
  // Give the research decoder a visible presentation surface while it owns a transaction.
  // A detached element can be throttled even when the containing page reports visible.
  video.setAttribute('aria-label', 'Research capture preview')
  video.style.cssText = 'position:fixed;right:8px;bottom:8px;width:160px;height:100px;object-fit:contain;background:black;z-index:50;pointer-events:none'
  document.body.appendChild(video)
  const start = performance.now()
  let stageStart = start, alive = true, assigned = false, callbackSequence = 0
  let lastSeekedTime: number | null = null
  const pending = new Set<(error: Error) => void>()
  const listeners: Array<() => void> = []
  const observe = (event: string, extra: Partial<CaptureEvent> = {}) => {
    diagnostic.events.push({ event, stage: diagnostic.state, elapsedMs: performance.now() - start,
      stageElapsedMs: performance.now() - stageStart, readyState: video.readyState, currentTime: video.currentTime,
      paused: video.paused, seeking: video.seeking, cancelled: signal.aborted,
      sourceChanged: assigned && video.src !== url, visibility: document.visibilityState, playbackRate: video.playbackRate, seekedTime: lastSeekedTime, wallClockMs: Date.now(), ...extra })
  }
  const transition = (stage: CaptureStage) => { diagnostic.state = stage; stageStart = performance.now(); observe('transition') }
  const guard = () => {
    if (!alive || signal.aborted) throw new ResearchCaptureError(signal.reason === 'SOURCE_CHANGE' ? 'SOURCE_CHANGE' : 'STALE_TRANSACTION', 'Research capture cancelled. No record created.')
    if (assigned && video.src !== url) throw new ResearchCaptureError('SOURCE_CHANGE', 'Research video source changed.')
  }
  const wait = <T>(reason: CaptureFailure, name: string, subscribe: (resolve: (value: T) => void, reject: (error: Error) => void) => () => void): Promise<T> => new Promise((resolve, reject) => {
    let settled = false, unsubscribe = () => {}
    const cleanup = () => { clearTimeout(timer); unsubscribe(); signal.removeEventListener('abort', aborted); video.removeEventListener('error', failed); pending.delete(bad) }
    const bad = (error: Error) => { if (settled) return; settled = true; cleanup(); reject(error) }
    const done = (value: T) => { if (settled) return; try { guard() } catch (error) { bad(error as Error); return }; settled = true; cleanup(); resolve(value) }
    const aborted = () => { try { guard() } catch (error) { bad(error as Error) } }
    const failed = () => bad(new ResearchCaptureError('DECODE_FAILURE', `Research video load/seek failed (${video.error?.code ?? 'unknown'}).`))
    const timer = setTimeout(() => { observe(`timeout:${name}`); bad(new ResearchCaptureError(reason, `${name} timed out. No research record created.`)) }, STAGE_TIMEOUT_MS)
    pending.add(bad); signal.addEventListener('abort', aborted, { once: true }); video.addEventListener('error', failed, { once: true })
    try { guard(); unsubscribe = subscribe(done, bad); if (settled) unsubscribe() } catch (error) { bad(error as Error) }
  })
  const event = (name: string, reason: CaptureFailure) => wait<void>(reason, name, resolve => {
    const listener = () => resolve()
    video.addEventListener(name, listener, { once: true })
    return () => video.removeEventListener(name, listener)
  })
  const canvas = document.createElement('canvas')
  let frozenImage = ''
  const presented = (freeze: boolean, drain = false, name = drain ? 'initial presentation' : freeze ? 'sought presentation' : 'following presentation') => wait<Presentation>('PRESENTATION_TIMEOUT', name, (resolve, reject) => {
    let handle: number
    const request = () => { observe('presentationRequested', { witness: name }); handle = video.requestVideoFrameCallback(callback) }
    const callback: VideoFrameRequestCallback = (now, m) => {
      // Even a queued callback delivered after cancellation must not touch the canvas/state.
      if (!alive || signal.aborted) return
      try {
        guard(); observe('presentationReceived', { witness: name, callbackSequence: ++callbackSequence, callbackNow: now, mediaTime: m.mediaTime, presentedFrames: m.presentedFrames, expectedDisplayTime: m.expectedDisplayTime, presentationTime: m.presentationTime, processingDuration: m.processingDuration })
        if (!drain && video.readyState < 2) throw new ResearchCaptureError('VIDEO_NOT_READY', 'Presented callback preceded decode readiness; retry independently instead of waiting on a paused frame.')
        if (freeze && Math.abs(video.currentTime - requestedTime) > 0.0001) throw new ResearchCaptureError('PRESENTATION_SKIPPED', 'Presented cursor does not match requested time.')
        const p = { mediaTime: m.mediaTime, presentedFrames: m.presentedFrames, expectedDisplayTime: m.expectedDisplayTime, currentTime: video.currentTime, elapsedMs: performance.now() - start }
        if (freeze) {
          transition('FREEZING_FRAME')
          const scale = Math.min(1, 1280 / video.videoWidth)
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
          const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable.')
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          frozenImage = canvas.toDataURL('image/jpeg', .92)
        }
        resolve(p)
      } catch (error) { reject(error as Error) }
    }
    request()
    return () => video.cancelVideoFrameCallback(handle)
  })
  try {
    guard(); transition('PREPARING_VIDEO')
    if (typeof video.requestVideoFrameCallback !== 'function') throw new ResearchCaptureError('OTHER', 'This browser cannot report presented frame timestamps.')
    for (const name of ['loadedmetadata', 'loadeddata', 'seeking', 'seeked', 'playing', 'pause', 'error']) {
      const listener = () => { if (name === 'seeked') lastSeekedTime = video.currentTime; observe(name) }; video.addEventListener(name, listener); listeners.push(() => video.removeEventListener(name, listener))
    }
    const loaded = event('loadeddata', 'VIDEO_NOT_READY')
    const initial = presented(false, true)
    video.src = url; assigned = true; video.load()
    await Promise.all([loaded, initial]); guard()
    if (!Number.isFinite(video.duration) || requestedTime >= video.duration) throw new ResearchCaptureError('OTHER', 'Timestamp must be before video end.')
    // Warm the exact requested surface, draining its callback even if it precedes seeked.
    // This is never a candidate image. Re-seek the SAME time only after decode readiness,
    // so the candidate callback cannot be stranded on the paused readiness race.
    observe('warmSeekStart')
    const warmSeek = event('seeked', 'SEEK_TIMEOUT')
    const warmPresentation = presented(false, true, 'warm sought presentation')
    video.currentTime = requestedTime
    await Promise.all([warmSeek, warmPresentation]); guard()
    // A same-frame re-seek need not produce rVFC. Advance one witnessed presentation
    // before seeking back to the exact request; the warm-up pixels are never accepted.
    const warmNext = presented(false, true, 'warm following presentation')
    video.playbackRate = 1
    await Promise.all([wait<void>('PRESENTATION_TIMEOUT', 'warm play', (resolve, reject) => { video.play().then(resolve, reject); return () => {} }), warmNext])
    video.pause(); guard(); observe('warmComplete')
    // Always explicitly seek, including zero, after the initial surface has been drained.
    transition('SEEKING'); observe('seekStart')
    let seekedCurrentTime: number | null = null, seekedElapsedMs: number | null = null
    const sought = event('seeked', 'SEEK_TIMEOUT').then(() => {
      guard()
      seekedCurrentTime = video.currentTime; seekedElapsedMs = performance.now() - start
      if (diagnostic.state === 'SEEKING') transition('WAITING_FOR_PRESENTATION')
    })
    const presentation = presented(true)
    video.currentTime = requestedTime
    const [, frame] = await Promise.all([sought, presentation]); guard()
    transition('VERIFYING')
    const nextAndFollowing = presented(false).then(async next => ({ next, following: await presented(false) }))
    // The timeout also bounds a play() promise which never settles.
    video.playbackRate = 1
    const playing = wait<void>('PRESENTATION_TIMEOUT', 'play', (resolve, reject) => { video.play().then(resolve, reject); return () => {} })
    const [, { next, following }] = await Promise.all([playing, nextAndFollowing])
    video.pause(); guard()
    let observedFrameCadence: number
    try { observedFrameCadence = verifyTiming(requestedTime, frame, next, following) }
    catch (error) { throw new ResearchCaptureError('PRESENTATION_SKIPPED', (error as Error).message) }
    transition('READY_FOR_DETECTION'); diagnostic.outcome = 'VERIFIED'
    return Object.freeze({ frameId, timestampSeconds: requestedTime, imageDataUrl: frozenImage, width: canvas.width, height: canvas.height, imageFingerprint: imageFingerprint(frozenImage),
      timing: Object.freeze({ requestedTime, actualTime: frame.mediaTime, differenceSeconds: frame.mediaTime - requestedTime, observedFrameCadence, currentTimeAtDraw: frame.currentTime, seekedCurrentTime, seekedElapsedMs, presentation: frame, followingPresentations: [next, following], integrity: 'VERIFIED' as const }) })
  } catch (error) {
    const failure = error instanceof ResearchCaptureError ? error : new ResearchCaptureError('OTHER', error instanceof Error ? error.message : String(error))
    diagnostic.reason = failure.reason; diagnostic.message = failure.message
    transition(signal.aborted ? 'CANCELLED' : 'FAILED'); throw failure
  } finally {
    alive = false
    for (const reject of [...pending]) reject(new ResearchCaptureError('STALE_TRANSACTION', 'Sub-attempt disposed.'))
    for (const remove of listeners) remove()
    video.pause(); video.removeAttribute('src'); video.load()
    video.remove()
    diagnostic.elapsedMs = performance.now() - start
  }
}

export async function captureResearchFrame(url: string, requestedTime: number, frameId: string, signal: AbortSignal, options: CaptureOptions = {}): Promise<FrozenResearchFrame> {
  if (!Number.isFinite(requestedTime) || requestedTime < 0) throw new ResearchCaptureError('OTHER', 'Enter a valid timestamp.')
  const attempts: CaptureAttempt[] = []
  for (let attempt = 1; attempt <= MAX_CAPTURE_ATTEMPTS; attempt++) {
    const diagnostic: CaptureAttempt = { transactionId: frameId, sourceId: options.sourceId ?? url, attemptId: `${frameId}/attempt-${attempt}`, elementId: `${frameId}/video-${attempt}`, requestedTime, state: 'IDLE', outcome: 'REJECTED', events: [], elapsedMs: 0 }
    try {
      const frame = await captureAttempt(url, requestedTime, frameId, signal, diagnostic)
      attempts.push(diagnostic); options.onAttempt?.(diagnostic)
      return Object.freeze({ ...frame, timing: Object.freeze({ ...frame.timing, attempts }) })
    } catch (error) {
      attempts.push(diagnostic); options.onAttempt?.(diagnostic)
      const failure = error instanceof ResearchCaptureError ? error : new ResearchCaptureError('OTHER', String(error))
      const transient = ['SEEK_TIMEOUT', 'PRESENTATION_TIMEOUT', 'PRESENTATION_SKIPPED', 'VIDEO_NOT_READY'].includes(failure.reason)
      if (signal.aborted || !transient || attempt === MAX_CAPTURE_ATTEMPTS) { failure.attempts = attempts; throw failure }
    }
  }
  throw new ResearchCaptureError('OTHER', 'Capture attempts exhausted.', attempts)
}

export type ResearchBatchResult = { requestedTime: number; status: 'VERIFIED' | 'REJECTED'; state: 'COMPLETE' | 'FAILED' | 'CANCELLED'; category?: CaptureFailure; reason?: string; attempts: CaptureAttempt[]; frameFingerprint?: string; actualTime?: number }
// process owns capture -> verification -> detection -> record. Await the complete operation,
// never just the seek. Cancellation stops the sequence and cannot publish a valid result.
export async function runResearchBatch(times: number[], signal: AbortSignal, process: (time: number, index: number) => Promise<FrozenResearchFrame>, record: (result: ResearchBatchResult) => void) {
  for (let index = 0; index < times.length; index++) {
    if (signal.aborted) break
    try {
      const frame = await process(times[index], index)
      if (signal.aborted) throw new ResearchCaptureError(signal.reason === 'SOURCE_CHANGE' ? 'SOURCE_CHANGE' : 'STALE_TRANSACTION', 'Research batch cancelled.', frame.timing.attempts)
      record({ requestedTime: times[index], status: 'VERIFIED', state: 'COMPLETE', attempts: frame.timing.attempts ?? [], frameFingerprint: frame.imageFingerprint, actualTime: frame.timing.actualTime })
    } catch (error) {
      record({ requestedTime: times[index], status: 'REJECTED', state: signal.aborted ? 'CANCELLED' : 'FAILED', category: error instanceof ResearchCaptureError ? error.reason : 'OTHER', reason: error instanceof Error ? error.message : String(error), attempts: error instanceof ResearchCaptureError ? error.attempts : [] })
      if (signal.aborted) break
    }
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

export function downloadResearchJson(json: string, filename = 'pose-research.json') {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename
  document.body.appendChild(anchor); anchor.click(); anchor.remove()
  // Let the browser start consuming the URL before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
