export type Phase = 'ready' | 'contact' | 'recovery'
// Bound browser JPEG storage and sequential multi-pass inference to 120 frames.
// Midpoint sampling covers the whole clip; long-form segmentation is out of scope.
export function planCoarseSampling(duration: number) {
  const targetInterval = 0.55
  const minFrames = 4
  const maxFrames = 120
  if (!Number.isFinite(duration) || duration <= 0) return {
    frameCount: 0, interval: 0, timestamps: [] as number[], capped: false,
    motionCompatible: false, reason: 'Insufficient sampling coverage: invalid video duration.',
  }
  const requested = Math.max(minFrames, Math.ceil(duration / targetInterval))
  const frameCount = Math.min(maxFrames, requested)
  const interval = duration / frameCount
  // Stay strictly inside the detector's unchanged 0.8s neighbor limit.
  const motionCompatible = interval < 0.8
  return { frameCount, interval, capped: requested > maxFrames, motionCompatible,
    timestamps: Array.from({ length: frameCount }, (_, i) => (i + 0.5) * interval),
    reason: motionCompatible ? null : 'Insufficient sampling coverage: the 120-frame cap cannot keep spacing below 0.8s. Automatic phases are unresolved; manual selection remains available.',
  }
}

export type Landmark = { x: number; y: number; visibility?: number }
export type PlayerFeatures = { center: { x: number; y: number }; area: number; landmarks: Landmark[] }

export type IdentityObservation = { timestamp: number; features: PlayerFeatures; segment?: number }
export type IdentityEvidence = { accepted: boolean; poseIndex: number | null; score: number; reason: string; observation?: IdentityObservation }
export type IdentityCandidate = { poseIndex: number; features: PlayerFeatures }
// Development-only observations; callbacks never participate in decisions.
export type IdentityDiagnostic = {
  code: string; continuity: 'tracking' | 'locked' | 'reacquisition_candidate' | 'reacquired'; ambiguity: boolean
  evaluated: number; plausible: number
  candidates: Array<{ poseIndex: number; plausible: boolean; reasons: string[]; targetDistance?: number; competitorDistance?: number }>
  confirmation?: { count: number; required: number; poseIndex: number | null }
  prerequisites?: {
    eligible: boolean; timestampFinite: boolean; reasons: string[]
    target: { available: number; unique: number; usable: number; required: number }
    competitor: { available: number; usable: number; required: number; allUsable: boolean }
    references: Array<{ kind: 'target' | 'competitor'; index: number; timestamp?: number; usable: boolean; reasons: string[] }>
  }
}
export type IdentityObserver = (diagnostic: IdentityDiagnostic) => void
export type ReacquisitionContext = { competitors: PlayerFeatures[] }
export type ReacquisitionHypothesis = { observations: IdentityObservation[] }

// Pose configuration only: unit limb directions relative to the torso, without
// face landmarks, limb-length signatures, appearance, or stale absolute position.
function reacquisitionGeometry(features: PlayerFeatures, aspect: number, issues?: string[]): number[] | null {
  const ids = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
  if (!Number.isFinite(aspect) || aspect <= 0 || !Number.isFinite(features.area) || features.area <= 0
    || !Number.isFinite(features.center.x) || !Number.isFinite(features.center.y)
    || !ids.every((i) => { const p = features.landmarks[i]; return p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility ?? 0) >= 0.75 })) {
    if (!Number.isFinite(aspect) || aspect <= 0) issues?.push('INVALID_ASPECT')
    if (!Number.isFinite(features.area) || features.area <= 0) issues?.push('INVALID_AREA')
    if (!Number.isFinite(features.center.x) || !Number.isFinite(features.center.y)) issues?.push('INVALID_CENTER')
    for (const i of ids) {
      const p = features.landmarks[i]
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) issues?.push(`LANDMARK_${i}_INVALID_COORDINATES`)
      if (!p || !((p.visibility ?? 0) >= 0.75)) issues?.push(`LANDMARK_${i}_INSUFFICIENT_VISIBILITY`)
    }
    return null
  }
  const point = (i: number) => ({ x: features.landmarks[i].x * aspect, y: features.landmarks[i].y })
  const a = point(11), b = point(12), c = point(23), d = point(24)
  const tx = (a.x + b.x - c.x - d.x) / 2, ty = (a.y + b.y - c.y - d.y) / 2
  const torso = Math.hypot(tx, ty)
  if (torso < 0.02) { issues?.push('TORSO_TOO_SHORT'); return null }
  const values: number[] = []
  for (const [i, j] of [[11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28]]) {
    const p = point(i), q = point(j), x = q.x - p.x, y = q.y - p.y, length = Math.hypot(x, y)
    if (length < 0.01) { issues?.push(`LIMB_${i}_${j}_TOO_SHORT`); return null }
    values.push((x * tx + y * ty) / (length * torso), (x * ty - y * tx) / (length * torso))
  }
  return values
}

// New reacquisition gates, not replacements for continuous identity thresholds.
// Three observations at the 0.55s cadence span about 1.1s; never bridge a missing
// confirmation sample beyond the existing 0.8s motion-neighbor limit.
export function evaluateReacquisition(trusted: IdentityObservation[], competitors: PlayerFeatures[], timestamp: number,
  candidates: IdentityCandidate[], aspect: number, hypothesis: ReacquisitionHypothesis | null = null) {
  const diagnostic: IdentityDiagnostic = { code: '', continuity: 'locked', ambiguity: false, evaluated: 0, plausible: 0, candidates: [], confirmation: { count: 0, required: 3, poseIndex: null } }
  const finish = (code: string, next: ReacquisitionHypothesis | null = null, winner?: IdentityCandidate) => {
    diagnostic.code = code
    diagnostic.continuity = winner ? 'reacquired' : next ? 'reacquisition_candidate' : 'locked'
    diagnostic.confirmation = { count: next?.observations.length ?? 0, required: 3, poseIndex: winner?.poseIndex ?? (next ? candidates.find((c) => c.features === next.observations[next.observations.length - 1].features)?.poseIndex ?? null : null) }
    const evidence: IdentityEvidence = winner
      ? { accepted: true, poseIndex: winner.poseIndex, score: 1 - (diagnostic.candidates.find((c) => c.poseIndex === winner.poseIndex)?.targetDistance ?? 1), reason: code, observation: { timestamp, features: winner.features } }
      : { accepted: false, poseIndex: null, score: 0, reason: code }
    return { evidence, diagnostic, hypothesis: winner ? null : next }
  }
  if (!candidates.length) return finish('REACQUISITION_NO_CANDIDATE')
  const audits: NonNullable<IdentityDiagnostic['prerequisites']>['references'] = []
  const unique = trusted.filter((r, i) => trusted.findIndex((s) => s.timestamp === r.timestamp) === i)
  const references = unique.map((r, index) => {
    const reasons: string[] = []
    const geometry = reacquisitionGeometry(r.features, aspect, reasons)
    audits.push({ kind: 'target', index, timestamp: r.timestamp, usable: geometry !== null, reasons })
    return geometry
  }).filter((r): r is number[] => r !== null)
  const negatives = competitors.map((f, index) => {
    const reasons: string[] = []
    const geometry = reacquisitionGeometry(f, aspect, reasons)
    audits.push({ kind: 'competitor', index, usable: geometry !== null, reasons })
    return geometry
  })
  // Observational only; retain the original authoritative eligibility gate below.
  const reasons: string[] = []
  if (!Number.isFinite(timestamp)) reasons.push('INVALID_REACQUISITION_TIMESTAMP')
  if (references.length < 2) {
    reasons.push('INSUFFICIENT_USABLE_TARGET_REFERENCES')
    if (unique.length < 2) reasons.push('INSUFFICIENT_UNIQUE_TARGET_REFERENCES')
    if (references.length < unique.length) reasons.push('TARGET_REFERENCES_UNUSABLE')
  }
  if (!negatives.length) reasons.push('INSUFFICIENT_COMPETITOR_REFERENCES')
  if (negatives.some((r) => r === null)) reasons.push('COMPETITOR_REFERENCES_UNUSABLE')
  diagnostic.prerequisites = {
    eligible: reasons.length === 0, timestampFinite: Number.isFinite(timestamp), reasons,
    target: { available: trusted.length, unique: unique.length, usable: references.length, required: 2 },
    competitor: { available: negatives.length, usable: negatives.filter((r) => r !== null).length,
      required: 1, allUsable: negatives.every((r) => r !== null) },
    references: audits,
  }
  // An anchor alone or incomplete competitor evidence cannot establish identity.
  if (!Number.isFinite(timestamp) || references.length < 2 || !negatives.length || negatives.some((r) => r === null)) return finish('REACQUISITION_NOT_ATTEMPTED_INSUFFICIENT_REFERENCE')
  const distance = (a: number[], b: number[]) => Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0) / a.length)
  const plausible: IdentityCandidate[] = []
  let unknownCompetitor = false
  for (const candidate of candidates) {
    const geometry = reacquisitionGeometry(candidate.features, aspect)
    const reasons: string[] = []
    let targetDistance: number | undefined, competitorDistance: number | undefined
    if (!geometry) { reasons.push('REACQUISITION_POSE_QUALITY'); unknownCompetitor = true }
    else {
      targetDistance = Math.min(...references.map((r) => distance(geometry, r)))
      competitorDistance = Math.min(...negatives.map((r) => distance(geometry, r!)))
      if (targetDistance > 0.08) reasons.push('REACQUISITION_TARGET_GEOMETRY')
      if (competitorDistance - targetDistance < 0.12) reasons.push('REACQUISITION_COMPETITOR_SEPARATION')
      if (!reasons.length) plausible.push(candidate)
    }
    diagnostic.candidates.push({ poseIndex: candidate.poseIndex, plausible: !reasons.length, reasons, targetDistance, competitorDistance })
  }
  diagnostic.evaluated = candidates.length
  diagnostic.plausible = plausible.length
  if (plausible.length > 1 || unknownCompetitor) { diagnostic.ambiguity = true; return finish('REACQUISITION_AMBIGUOUS') }
  if (plausible.length !== 1) return finish('REACQUISITION_REJECTED')
  const winner = plausible[0]
  if (hypothesis) {
    const observations = hypothesis.observations
    const dt = timestamp - observations[observations.length - 1].timestamp
    const previousDt = observations.length > 1 ? observations[observations.length - 1].timestamp - observations[observations.length - 2].timestamp : dt
    // Fresh local continuity is only confirmation, never the identity evidence.
    const step = identityStep(observations, timestamp, candidates, aspect)
    if (Math.abs(dt) > 0.8 || dt * previousDt <= 0 || !step.accepted || step.poseIndex !== winner.poseIndex) return finish('REACQUISITION_HYPOTHESIS_RESET')
  }
  const next = { observations: [...(hypothesis?.observations ?? []), { timestamp, features: winner.features }] }
  return finish(next.observations.length >= 3 ? 'REACQUISITION_CONFIRMED' : 'REACQUISITION_PENDING_CONFIRMATION', next, next.observations.length >= 3 ? winner : undefined)
}
// Geometric continuity is evidence, not recognition. Never restart from the old
// anchor after a crossing or long gap: similar teammates cannot be distinguished.
export function identityStep(history: IdentityObservation[], timestamp: number, candidates: IdentityCandidate[], aspect: number, observe?: IdentityObserver): IdentityEvidence {
  const diagnostic: IdentityDiagnostic = { code: '', continuity: 'tracking', ambiguity: false, evaluated: 0, plausible: 0, candidates: [] }
  const report = (code: string, locked = false) => { diagnostic.code = code; diagnostic.continuity = locked ? 'locked' : 'tracking'; observe?.(diagnostic) }
  const reject = (reason: string): IdentityEvidence => ({ accepted: false, poseIndex: null, score: 0, reason })
  const last = history[history.length - 1]
  if (!last || !Number.isFinite(timestamp) || !Number.isFinite(aspect) || aspect <= 0) { report('MISSING_IDENTITY_REFERENCE'); return reject('Missing identity reference') }
  const dt = timestamp - last.timestamp
  if (Math.abs(dt) > 1.2 || Math.abs(dt) < 0.000001) { report('UNSUPPORTED_IDENTITY_GAP', true); return reject('Unsupported identity gap; manual re-anchor required') }
  const previous = history[history.length - 2]
  const velocity = previous && (last.timestamp - previous.timestamp) * dt > 0
    ? { x: (last.features.center.x - previous.features.center.x) / (last.timestamp - previous.timestamp), y: (last.features.center.y - previous.features.center.y) / (last.timestamp - previous.timestamp) }
    : { x: 0, y: 0 }
  const expected = { x: last.features.center.x + velocity.x * dt, y: last.features.center.y + velocity.y * dt }
  const distance = (a: PlayerFeatures['center'], b: PlayerFeatures['center']) => Math.hypot((a.x - b.x) * aspect, a.y - b.y)
  // A modest acceleration allowance; missing observations never expand the gate
  // indefinitely. Scale is compared to the latest observation, not anchor size.
  const radius = 0.035 + 0.10 * Math.abs(dt)
  const plausible = candidates.filter(({ poseIndex, features: f }) => {
    const areaValid = f.area > 0 && Number.isFinite(f.area)
    const trajectoryValid = distance(f.center, expected) <= radius
    const scaleValid = Math.abs(Math.log(f.area / last.features.area)) <= 0.45
    const valid = areaValid && trajectoryValid && scaleValid
    diagnostic.candidates.push({ poseIndex, plausible: valid, reasons: [
      ...(!areaValid ? ['INVALID_AREA'] : []),
      ...(!trajectoryValid ? ['IDENTITY_TRAJECTORY_REJECTED'] : []),
      ...(!scaleValid ? ['IDENTITY_SCALE_REJECTED'] : []),
    ] })
    return valid
  })
  diagnostic.evaluated = candidates.length
  diagnostic.plausible = plausible.length
  if (plausible.length > 1) { diagnostic.ambiguity = true; report('AMBIGUOUS_CANDIDATES', true); return reject('Ambiguous crossing / competing identity trajectories; manual re-anchor required') }
  if (!plausible.length) { report(candidates.length ? 'NO_PLAUSIBLE_TARGET' : 'NO_POSE_DETECTED'); return reject('No motion-consistent TARGET_A observation') }
  const match = matchPhaseTarget(last.features, plausible)
  if (!match.reliable) {
    diagnostic.candidates.find((c) => c.plausible)!.reasons.push(`MATCH_${(match.rejection ?? 'UNKNOWN').toUpperCase().replace(/ /g, '_')}`)
    report('IDENTITY_POSE_REJECTED')
    return reject(`Weak identity evidence: ${match.rejection}`)
  }
  report('ACCEPTED_TARGET')
  const winner = plausible[0]
  return { accepted: true, poseIndex: winner.poseIndex, score: match.score, reason: 'Unique short-gap trajectory, compatible scale and visible torso', observation: { timestamp, features: winner.features } }
}

export function trackIdentity(anchor: IdentityObservation, frames: Array<{ frameId: string; timestamp: number; candidates: IdentityCandidate[] }>, aspect: number, observe?: (frameId: string, diagnostic: IdentityDiagnostic) => void, reacquisition?: ReacquisitionContext) {
  const evidence = new Map<string, IdentityEvidence>()
  for (const direction of [-1, 1]) {
    const history = [anchor]
    let locked = false
    let hypothesis: ReacquisitionHypothesis | null = null
    let segment = 0
    const competitors = [...(reacquisition?.competitors ?? [])]
    const ordered = frames.filter((f) => (f.timestamp - anchor.timestamp) * direction > 0.000001)
      .sort((a, b) => direction * (a.timestamp - b.timestamp) || a.frameId.localeCompare(b.frameId))
    for (const frame of ordered) {
      if (locked && reacquisition) {
        const attempt = evaluateReacquisition(history, competitors, frame.timestamp, frame.candidates, aspect, hypothesis)
        hypothesis = attempt.hypothesis
        observe?.(frame.frameId, attempt.diagnostic)
        if (attempt.evidence.observation) {
          // Do not backfill hypotheses or carry stale velocity across the gap.
          segment += direction
          attempt.evidence.observation.segment = segment
          history.splice(0, history.length, attempt.evidence.observation)
          locked = false
        }
        evidence.set(frame.frameId, attempt.evidence)
        continue
      }
      if (locked) observe?.(frame.frameId, { code: 'CONTINUITY_LOCKED', continuity: 'locked', ambiguity: false, evaluated: 0, plausible: 0, candidates: [] })
      const result = locked ? { accepted: false, poseIndex: null, score: 0, reason: 'Identity continuity lost; manual re-anchor required' } : identityStep(history, frame.timestamp, frame.candidates, aspect, (d) => observe?.(frame.frameId, d))
      evidence.set(frame.frameId, result)
      if (result.observation && segment !== 0) result.observation.segment = segment
      if (result.observation) history.push(result.observation)
      if (reacquisition && result.accepted) competitors.push(...frame.candidates.filter((c) => c.poseIndex !== result.poseIndex).map((c) => c.features))
      if (result.reason.includes('manual re-anchor')) locked = true
    }
  }
  return evidence
}

// Refined candidates need agreement from trusted observations on BOTH sides.
export function refineIdentity(references: IdentityObservation[], timestamp: number, candidates: IdentityCandidate[], aspect: number): IdentityEvidence {
  const before = references.filter((r) => r.timestamp < timestamp).sort((a, b) => a.timestamp - b.timestamp)
  const after = references.filter((r) => r.timestamp > timestamp).sort((a, b) => b.timestamp - a.timestamp)
  const segment = before[before.length - 1]?.segment ?? 0
  if (segment !== (after[after.length - 1]?.segment ?? 0)) return { accepted: false, poseIndex: null, score: 0, reason: 'Refinement cannot bridge a reacquisition boundary' }
  const a = identityStep(before.filter((r) => (r.segment ?? 0) === segment).slice(-2), timestamp, candidates, aspect)
  const b = identityStep(after.filter((r) => (r.segment ?? 0) === segment).slice(-2), timestamp, candidates, aspect)
  if (!a.accepted || !b.accepted || a.poseIndex !== b.poseIndex) return { accepted: false, poseIndex: null, score: 0, reason: 'Refinement lacks agreeing identity continuity on both sides' }
  return { ...a, ...(a.observation && segment !== 0 ? { observation: { ...a.observation, segment } } : {}), reason: 'Identity supported by trusted observations before and after' }
}

// Shared by phase acceptance and automatic biomechanics: absence fails closed.
export function identitySequenceAllowed(frameIds: string[], lookup: (id: string) => IdentityEvidence | undefined) {
  return frameIds.length === 3 && new Set(frameIds).size === 3 && frameIds.every((id) => {
    const e = lookup(id)
    return e?.accepted === true && e.poseIndex !== null && !!e.observation
  })
}

// Existing TARGET_A anchor score, unchanged. Indices are never identity features.
export function scorePlayerMatch(anchor: PlayerFeatures, cand: PlayerFeatures) {
  const dist = Math.hypot(anchor.center.x - cand.center.x, anchor.center.y - cand.center.y)
  const centerScore = 1 - Math.min(dist / 1.41421356, 1)
  const maxArea = Math.max(anchor.area, cand.area)
  const sizeScore = maxArea > 0 ? 1 - Math.min(Math.abs(anchor.area - cand.area) / maxArea, 1) : 0
  const pairs = Math.min(anchor.landmarks.length, cand.landmarks.length)
  let lmDist = 1
  if (pairs > 0) {
    let sum = 0
    for (let i = 0; i < pairs; i++) sum += Math.hypot(anchor.landmarks[i].x - cand.landmarks[i].x, anchor.landmarks[i].y - cand.landmarks[i].y)
    lmDist = 1 - Math.min(sum / pairs / 0.5, 1)
  }
  return { overall: 0.5 * centerScore + 0.25 * sizeScore + 0.25 * lmDist, centerScore, sizeScore, lmDist }
}

export function matchPhaseTarget(anchor: PlayerFeatures, candidates: Array<{ poseIndex: number; features: PlayerFeatures }>) {
  const ranked = candidates.map((c) => ({ ...c, ...scorePlayerMatch(anchor, c.features) }))
    .filter((c) => Number.isFinite(c.overall)).sort((a, b) => b.overall - a.overall || a.poseIndex - b.poseIndex)
  const best = ranked[0]
  const margin = best ? best.overall - (ranked[1]?.overall ?? 0) : 0
  // Stricter than manual matching: fail closed on crossings, distant candidates,
  // poor torso visibility, or weak scale agreement. Never advance a drifting anchor.
  const reliable = !!best && best.overall >= 0.75 && margin >= 0.08 && best.sizeScore >= 0.45
    && Math.hypot(best.features.center.x - anchor.center.x, best.features.center.y - anchor.center.y) <= 0.22
    && [11, 12, 23, 24].every((i) => (best.features.landmarks[i]?.visibility ?? 0) >= 0.5)
  const rejection = !best ? 'no pose' : best.overall < 0.75 ? 'low score' : margin < 0.08 ? 'ambiguous' : best.sizeScore < 0.45 ? 'scale' : Math.hypot(best.features.center.x - anchor.center.x, best.features.center.y - anchor.center.y) > 0.22 ? 'displacement' : !reliable ? 'torso visibility' : null
  return { poseIndex: reliable ? best.poseIndex : null, score: best?.overall ?? 0, secondScore: ranked[1]?.overall ?? null, margin, reliable, rejection }
}

export type PhaseCandidate = {
  frameId: string; timestamp: number; targetScore: number; matched: boolean
  reach: number | null; wrist: { x: number; y: number } | null
}

// IMAGE-space motion features only. No biomechanical angles, world coordinates,
// reliability flags or experimental metrics are repurposed as phase ground truth.
export function phaseGeometry(landmarks: Landmark[], aspect: number, hand: 'left' | 'right') {
  const ids = hand === 'right' ? [12, 14, 16] : [11, 13, 15]
  if (!Number.isFinite(aspect) || aspect <= 0 || ![11, 12, 23, 24, ...ids].every((i) => {
    const p = landmarks[i]
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility ?? 0) >= 0.5
  })) return { reach: null, wrist: null }
  const point = (i: number) => ({ x: landmarks[i].x * aspect, y: landmarks[i].y })
  const a = point(11), b = point(12), c = point(23), d = point(24)
  const shoulder = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const torso = Math.hypot(shoulder.x - (c.x + d.x) / 2, shoulder.y - (c.y + d.y) / 2)
  if (torso < 0.02) return { reach: null, wrist: null }
  const w = point(ids[2]), s = point(ids[0])
  return { reach: Math.hypot(w.x - s.x, w.y - s.y) / torso,
    wrist: { x: (w.x - shoulder.x) / torso, y: (w.y - shoulder.y) / torso } }
}

export type PhaseProposal = { phase: Phase; frameId: string; timestamp: number; score: number; confidence: 'medium' | 'low'; reasons: string[] }
export type PhaseResult = { proposals: PhaseProposal[]; reasons: string[]; candidates: Array<PhaseCandidate & { motion: number | null; incoming: number | null; outgoing: number | null }> }

type PhaseBounds = Partial<Record<Phase, { start: number; end: number }>>
export function detectPhases(input: PhaseCandidate[], bounds: PhaseBounds = {}, excludedContact?: string): PhaseResult {
  return scorePhaseSequence(input, bounds, excludedContact)
}

function scorePhaseSequence(input: PhaseCandidate[], bounds: PhaseBounds, excludedContact?: string, assessFixedBaseline = false): PhaseResult {
  const counts = new Map<string, number>()
  input.forEach((f) => counts.set(f.frameId, (counts.get(f.frameId) ?? 0) + 1))
  const frames = input.filter((f) => counts.get(f.frameId) === 1 && Number.isFinite(f.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp || a.frameId.localeCompare(b.frameId))
  const usable = (f: PhaseCandidate) => f.matched && f.targetScore >= 0.75 && Number.isFinite(f.reach)
    && f.reach !== null && f.wrist !== null && Number.isFinite(f.wrist.x) && Number.isFinite(f.wrist.y)
  const gaps = frames.slice(1).map((f, i) => f.timestamp - frames[i].timestamp).filter((g) => g > 0).sort((a, b) => a - b)
  const cadence = gaps[Math.floor(gaps.length / 2)] ?? 0
  const separation = Math.max(0.12, cadence * 0.75)
  const candidates = frames.map((f, i) => {
    const speed = (n: PhaseCandidate | undefined) => n && usable(n) && usable(f)
      && Math.abs(n.timestamp - f.timestamp) > 0 && Math.abs(n.timestamp - f.timestamp) <= Math.min(0.8, cadence * 1.6)
      ? Math.hypot(n.wrist!.x - f.wrist!.x, n.wrist!.y - f.wrist!.y) / Math.abs(n.timestamp - f.timestamp) : null
    const incoming = speed(frames[i - 1]), outgoing = speed(frames[i + 1])
    const motion = incoming === null && outgoing === null ? null : Math.max(incoming ?? 0, outgoing ?? 0)
    return { ...f, motion, incoming, outgoing }
  })
  const valid = candidates.filter((f) => usable(f) && f.motion !== null)
  const unresolved = (reason: string): PhaseResult => ({ proposals: [], reasons: [reason], candidates })
  if (valid.length < 4 || cadence > 0.8) return unresolved('Insufficient closely spaced, reliably matched TARGET_A frames. Use manual selection.')
  const reaches = valid.map((f) => f.reach!)
  const minReach = Math.min(...reaches), range = Math.max(...reaches) - minReach
  const maxMotion = Math.max(...valid.map((f) => f.motion!))
  // Noise floors in torso lengths and torso lengths/second; ranking above them is
  // relative to this clip, rather than stroke-specific joint-angle thresholds.
  if (maxMotion < 0.3) return unresolved('No distinct arm-action signal above the motion noise floor. Use manual selection.')
  const reachRank = (f: typeof valid[number]) => range >= 0.2 ? (f.reach! - minReach) / range : 0.5
  // Reach can stay nearly constant in a compact or foreshortened stroke. Weight
  // the action interval and its onset, rather than demanding maximum extension.
  const action = (f: typeof valid[number]) => 0.65 * (f.outgoing ?? 0) / maxMotion + 0.2 * (f.incoming ?? 0) / maxMotion + 0.15 * reachRank(f)
  const triples: Array<{ r: typeof valid[number]; c: typeof valid[number]; x: typeof valid[number]; score: number; scores: number[] }> = []
  const within = (phase: Phase, time: number) => !bounds[phase] || (time >= bounds[phase]!.start && time <= bounds[phase]!.end)
  for (const c of valid) {
    if (!within('contact', c.timestamp) || c.frameId === excludedContact) continue
    for (const r of valid) {
      if (!within('ready', r.timestamp)) continue
      const before = c.timestamp - r.timestamp
      if (before < separation || before > 1.5 || c.outgoing === null) continue
      for (const x of valid) {
        if (!within('recovery', x.timestamp)) continue
        const after = x.timestamp - c.timestamp
        if (after < separation || after > 1.5 || x.outgoing === null) continue
        if (r.outgoing === null || (!assessFixedBaseline && (r.outgoing >= c.outgoing * 0.8 || x.outgoing >= c.outgoing * 0.8))) continue
        if (candidates.some((f) => f.timestamp >= r.timestamp && f.timestamp <= x.timestamp && !usable(f))) continue
        const ready = 0.75 * (1 - r.outgoing / maxMotion) + 0.15 * (1 - reachRank(r)) + 0.1 * separation / before
        const recovery = 0.75 * (1 - x.outgoing / maxMotion) + 0.15 * (1 - reachRank(x)) + 0.1 * separation / after
        const score = (0.25 * ready + 0.5 * action(c) + 0.25 * recovery) * Math.min(r.targetScore, c.targetScore, x.targetScore)
        triples.push({ r, c, x, score, scores: [ready, action(c), recovery] })
      }
    }
  }
  triples.sort((a, b) => b.score - a.score || a.c.timestamp - b.c.timestamp || a.r.timestamp - b.r.timestamp || a.x.timestamp - b.x.timestamp)
  const best = triples[0]
  if (!best || (!assessFixedBaseline && best.score < 0.4)) return unresolved('No supported ordered Ready → Contact → Recovery sequence. Keep manual selection.')
  const rival = triples.find((t) => Math.abs(t.c.timestamp - best.c.timestamp) > cadence * 1.5)
  const ambiguous = !!rival && best.score - rival.score < 0.06
  return { candidates, reasons: [ambiguous ? 'Multiple action peaks are similarly plausible; review the proposed stroke.' : 'Strongest ordered arm-action sequence.', 'Contact is a pose-based proxy; ball/paddle impact is not measured. Scores are relative rankings, not probabilities.'],
    proposals: ([best.r, best.c, best.x] as const).map((f, i) => ({
      phase: (['ready', 'contact', 'recovery'] as const)[i], frameId: f.frameId, timestamp: f.timestamp,
      score: best.scores[i] * f.targetScore, confidence: ambiguous || best.score < 0.6 || cadence > 0.4 ? 'low' : 'medium',
      reasons: [i === 1 ? 'Start of a strong paddle-side wrist-motion interval; arm reach provides supporting evidence.' : i === 0 ? 'Lower wrist motion before the action interval.' : 'Lower outgoing wrist motion after the action interval: a settling/recovery candidate.', `TARGET_A anchor match ${f.targetScore.toFixed(2)}.`, `Minimum phase separation ${separation.toFixed(2)}s.`],
    })) }
}

export function overridePhase<T>(current: Record<Phase, T>, phase: Phase, value: T): Record<Phase, T> {
  return { ...current, [phase]: value }
}

export type RefinementWindow = { phase: Phase; coarseTimestamp: number; start: number; end: number; timestamps: number[] }
export type RefinementPlan = { interval: number; windows: RefinementWindow[] }
export type RefinementResult = {
  proposals: PhaseProposal[]
  comparison?: Array<{ phase: Phase; validCandidates: number; coarseScore: number; challengerScore: number; challengerFrameId: string; challengerTimestamp: number }>
  details: Array<{ phase: Phase; coarseTimestamp: number; refinedTimestamp: number; adjustment: number; accepted: boolean; reason: string }>
}

// Inputs are scored on the same dense evidence and identity-validated upstream.
// Enumerate at most eight mixes; phase gains cannot compensate for a regression.
export function selectMixedPhases(baseline: PhaseProposal[], challengers: PhaseProposal[]): PhaseProposal[] {
  const order: Phase[] = ['ready', 'contact', 'recovery']
  const coarse = order.map((phase) => baseline.find((p) => p.phase === phase))
  if (coarse.some((p) => !p)) return baseline
  const incumbent = coarse as PhaseProposal[]
  const alternatives = order.map((phase, i) => {
    const p = challengers.find((c) => c.phase === phase)
    return p && Number.isFinite(p.score) && Number.isFinite(p.timestamp) && p.score >= incumbent[i].score + 0.04 - 1e-9
      && p.frameId !== incumbent[i].frameId && Math.abs(p.timestamp - incumbent[i].timestamp) > 1e-6 ? p : null
  })
  const mixes: Array<{ proposals: PhaseProposal[]; gain: number; movement: number; mask: number }> = []
  for (let mask = 0; mask < 8; mask++) {
    if (alternatives.some((p, i) => (mask & (1 << i)) && !p)) continue
    const proposals = incumbent.map((p, i) => mask & (1 << i) ? alternatives[i]! : p)
    if (new Set(proposals.map((p) => p.frameId)).size !== 3 || proposals.some((p, i) => !Number.isFinite(p.timestamp) || !Number.isFinite(p.score)
      || (i > 0 && (p.timestamp - proposals[i - 1].timestamp < 0.12 - 1e-6 || p.timestamp - proposals[i - 1].timestamp > 1.5)))) continue
    mixes.push({ proposals, mask, gain: proposals.reduce((sum, p, i) => sum + (p.score - incumbent[i].score) * (i === 1 ? 0.5 : 0.25), 0),
      movement: proposals.reduce((sum, p, i) => sum + Math.abs(p.timestamp - incumbent[i].timestamp), 0) })
  }
  mixes.sort((a, b) => b.gain - a.gain || a.movement - b.movement || a.mask - b.mask)
  return mixes[0]?.proposals ?? baseline
}

// Bound work independently of video length. Neighbor midpoints reserve 120 ms
// between phase windows, so neither refinement nor fallback can cross phases.
export function planPhaseRefinement(coarse: PhaseProposal[], duration: number, options: { radius?: number; interval?: number } = {}): RefinementPlan {
  const order: Phase[] = ['ready', 'contact', 'recovery']
  const sorted = order.map((p) => coarse.find((c) => c.phase === p))
  const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))
  const interval = Number.isFinite(options.interval) ? clamp(options.interval!, 0.06, 0.12) : 0.08
  if (coarse.length !== 3 || !Number.isFinite(duration) || duration <= 0 || sorted.some((p) => !p || !Number.isFinite(p.timestamp) || p.timestamp < 0 || p.timestamp >= duration)
    || new Set(coarse.map((p) => p.frameId)).size !== 3) return { interval, windows: [] }
  const phases = sorted as PhaseProposal[]
  const gaps = [phases[1].timestamp - phases[0].timestamp, phases[2].timestamp - phases[1].timestamp]
  if (gaps.some((g) => g < 0.12)) return { interval, windows: [] }
  const radius = Number.isFinite(options.radius) ? clamp(options.radius!, 0.15, 0.5) : clamp(Math.min(...gaps) * 0.75, 0.2, 0.45)
  const windows = phases.map((p, i) => {
    const start = Math.max(0, p.timestamp - radius, i ? (phases[i - 1].timestamp + p.timestamp) / 2 + 0.06 : 0)
    const end = Math.min(duration - 0.001, p.timestamp + radius, i < 2 ? (phases[i + 1].timestamp + p.timestamp) / 2 - 0.06 : duration)
    const timestamps = [p.timestamp]
    for (let offset = 1; offset <= Math.ceil(radius / interval); offset++) {
      for (const sign of [-1, 1]) {
        const t = p.timestamp + sign * offset * interval
        if (t >= start && t <= end) timestamps.push(t)
      }
    }
    return { phase: p.phase, coarseTimestamp: p.timestamp, start, end, timestamps: timestamps.sort((a, b) => a - b) }
  })
  return { interval, windows: windows.some((w) => w.coarseTimestamp < w.start || w.coarseTimestamp > w.end) ? [] : windows }
}

// Coarse and refined scores are compared within the same dense evidence pool;
// comparing scores normalized on two different sampling grids would be misleading.
export function refinePhases(coarse: PhaseResult, input: PhaseCandidate[], plan: RefinementPlan): RefinementResult {
  let comparison: RefinementResult['comparison']
  const retained = (reason: string, ambiguous = false): RefinementResult => ({
    comparison,
    proposals: coarse.proposals.map((p) => ({ ...p, confidence: ambiguous ? 'low' : p.confidence })),
    details: coarse.proposals.map((p) => ({ phase: p.phase, coarseTimestamp: p.timestamp, refinedTimestamp: p.timestamp, adjustment: 0, accepted: false, reason })),
  })
  if (plan.windows.length !== 3 || coarse.proposals.length !== 3) return retained('Refinement unresolved: no valid local search plan.')
  const bounds = Object.fromEntries(plan.windows.map((w) => [w.phase, { start: w.start, end: w.end }])) as PhaseBounds
  if (coarse.proposals.some((p) => !plan.windows.some((w) => w.phase === p.phase && w.coarseTimestamp === p.timestamp && w.start <= p.timestamp && w.end >= p.timestamp))) return retained('Refinement plan does not match the coarse sequence.')
  // Ignore observations outside the requested local sample grid, including
  // duplicate timestamps. Never create motion across an unmatched observation.
  const samples = plan.windows.flatMap((w) => w.timestamps)
  const candidates: PhaseCandidate[] = samples.map((timestamp) => {
    const matches = input.filter((f) => Math.abs(f.timestamp - timestamp) < 0.000001)
    const f = matches[0]
    return matches.length === 1 && Number.isFinite(f.targetScore) && f.targetScore <= 1 ? f
      : { frameId: `missing-${timestamp}`, timestamp, targetScore: 0, matched: false, reach: null, wrist: null }
  })
  const coarseBounds = Object.fromEntries(coarse.proposals.map((p) => [p.phase, { start: p.timestamp - 0.000001, end: p.timestamp + 0.000001 }])) as PhaseBounds
  // Evaluate the incumbent's actual dense scores, even if finer sampling reveals
  // it no longer satisfies the action/deceleration selection rule. Requiring it
  // to win eligibility again prevents correcting precisely that timing error.
  // Identity, visible geometry, observed motion and temporal checks still apply.
  const baseline = scorePhaseSequence(candidates, coarseBounds, undefined, true)
  const best = detectPhases(candidates, bounds)
  if (best.proposals.length !== 3) return retained(`Local solver unresolved: ${best.reasons[0]}`)
  if (baseline.proposals.length !== 3) return retained(`Coarse baseline unsupported on dense motion: ${baseline.reasons[0]} Local solver found a sequence, but comparison is unresolved.`)
  comparison = best.proposals.map((p, i) => ({ phase: p.phase, coarseScore: baseline.proposals[i].score, challengerScore: p.score,
    challengerFrameId: p.frameId, challengerTimestamp: p.timestamp,
    validCandidates: best.candidates.filter((c) => c.timestamp >= bounds[p.phase]!.start && c.timestamp <= bounds[p.phase]!.end && c.matched && c.targetScore >= 0.75 && c.reach !== null && c.wrist !== null && c.outgoing !== null).length }))
  const quality = (result: PhaseResult) => result.proposals.reduce((sum, p) => sum + p.score * (p.phase === 'contact' ? 0.5 : 0.25), 0)
  const rival = detectPhases(candidates, bounds, best.proposals[1].frameId)
  const ambiguous = rival.proposals.length === 3 && quality(best) - quality(rival) < 0.03
  // Ambiguous Contact cannot move; it does not veto independent phase gains.
  const mixed = selectMixedPhases(baseline.proposals, best.proposals.filter((p) => !ambiguous || p.phase !== 'contact'))
  const proposals = mixed.map((p, i) => {
    if (Math.abs(p.timestamp - coarse.proposals[i].timestamp) < 1e-6) return { ...coarse.proposals[i], confidence: ambiguous ? 'low' as const : coarse.proposals[i].confidence }
    const target = candidates.find((f) => f.frameId === p.frameId)!
    // More samples alone never promote confidence. Require reliable identity,
    // a separated winner and a supported complete local motion sequence.
    const confidence = !ambiguous && target.targetScore >= 0.9 && p.score >= 0.65 && p.confidence === 'medium' && !coarse.reasons.some((r) => /multiple action peaks/i.test(r)) ? 'medium' as const : 'low' as const
    return { ...p, confidence, reasons: [...p.reasons, `Local refinement from ${coarse.proposals[i].timestamp.toFixed(2)}s; action candidate, not verified impact.`] }
  })
  if (new Set(proposals.map((p) => p.frameId)).size !== 3 || proposals.some((p, i) => i > 0 && p.timestamp - proposals[i - 1].timestamp < 0.12 - 0.000001)) return retained('Refinement violated temporal constraints; coarse retained.')
  return { proposals, comparison, details: proposals.map((p, i) => ({ phase: p.phase, coarseTimestamp: coarse.proposals[i].timestamp, refinedTimestamp: p.timestamp,
    adjustment: p.timestamp - coarse.proposals[i].timestamp, accepted: Math.abs(p.timestamp - coarse.proposals[i].timestamp) > 0.000001,
    reason: Math.abs(p.timestamp - coarse.proposals[i].timestamp) > 1e-6 ? 'Phase score improves by at least 0.040; valid mixed sequence preserves TARGET_A and temporal constraints.'
      : ambiguous && p.phase === 'contact' ? 'Competing local action candidates are ambiguous; coarse Contact retained.'
      : best.proposals[i].score < baseline.proposals[i].score + 0.04 ? 'Local challenger does not improve this phase by 0.040; coarse retained.'
      : 'Coarse retained to preserve a valid ordered, unique mixed sequence.' })) }
}

// Shadow provenance only. This view is never an input to tracking or reacquisition.
export type ReferenceObservation = {
  videoId: string | null; runId: string | null; frameId: string; timestamp: number
  role: 'target' | 'competitor'; candidateId: string; detectionSource: string | null
  coordinates: 'full-frame-normalized-image'; aspect: number
  direction: 'anchor' | 'forward' | 'backward'; segment: number
  acceptanceOrigin: string; identityStatus: 'trusted-target' | 'unresolved-competitor'
  targetTrustedAtCollection: true; physicalIdentity: 'TARGET_A' | null
  qualification: 'qualified' | 'unusable'; qualityFailures: string[]
  shadowReferenceEligible: boolean; supportingFrameId: string
  // Distinct timestamps are not a claim of independent identity evidence.
  duplicateTimestamp: boolean
}
export type ReferenceLedgerFrame = {
  frameId: string; timestamp: number; evidence: IdentityEvidence
  candidates: Array<IdentityCandidate & { detectionSource?: string }>
}
export function buildReferenceLedger(videoId: string | null, runId: string | null, anchorTime: number,
  aspect: number, frames: ReferenceLedgerFrame[]) {
  const records: ReferenceObservation[] = []
  const seen = new Set<string>(), targetTimes = new Set<number>()
  for (const frame of [...frames].sort((a, b) => a.timestamp - b.timestamp || a.frameId.localeCompare(b.frameId))) {
    const e = frame.evidence
    if (!e.accepted || e.poseIndex === null || !e.observation) continue
    for (const candidate of frame.candidates) {
      const target = candidate.poseIndex === e.poseIndex
      // Match the existing collector: confirmation itself does not enroll negatives.
      if (!target && e.reason === 'REACQUISITION_CONFIRMED') continue
      const key = `${frame.frameId}:${candidate.poseIndex}`
      if (seen.has(key)) continue
      seen.add(key)
      const qualityFailures: string[] = []
      const qualified = reacquisitionGeometry(candidate.features, aspect, qualityFailures) !== null
      const duplicateTimestamp = target && targetTimes.has(frame.timestamp)
      if (target) targetTimes.add(frame.timestamp)
      records.push({ videoId, runId, frameId: frame.frameId, timestamp: frame.timestamp,
        role: target ? 'target' : 'competitor', candidateId: key,
        detectionSource: candidate.detectionSource ?? null, coordinates: 'full-frame-normalized-image', aspect,
        direction: frame.timestamp === anchorTime ? 'anchor' : frame.timestamp > anchorTime ? 'forward' : 'backward',
        segment: e.observation.segment ?? 0, acceptanceOrigin: e.reason,
        identityStatus: target ? 'trusted-target' : 'unresolved-competitor', targetTrustedAtCollection: true,
        physicalIdentity: target ? 'TARGET_A' : null, qualification: qualified ? 'qualified' : 'unusable', qualityFailures,
        shadowReferenceEligible: target && qualified && !duplicateTimestamp,
        supportingFrameId: frame.frameId, duplicateTimestamp })
    }
  }
  return { records, qualifiedTargets: records.filter((r) => r.shadowReferenceEligible) }
}

// Dense acquisition is shadow-only. Never feed its output into trackIdentity,
// evaluateReacquisition, phase selection, or the support input of another pass.
export type AcquisitionSupport = {
  frameId: string; timestamp: number; evidence: IdentityEvidence; diagnosticCode: string
  origin: 'coarse' | 'manual-anchor' | 'dense'
  direction: 'anchor' | 'forward' | 'backward'
}
export type AcquisitionBracket = {
  id: string; left: AcquisitionSupport; right: AcquisitionSupport
  direction: 'forward' | 'backward'; segment: number; timestamps: number[]
  requested: number; incomplete: boolean
}
export function planTargetAcquisition(input: AcquisitionSupport[]) {
  const cadence = 0.1, perBracketCap = 10, perRunCap = 60
  // Clone and recursively freeze: caller mutations and harvested results cannot
  // change the pre-existing evidence supporting this pass.
  const freeze = <T,>(value: T): T => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze)
      Object.freeze(value)
    }
    return value
  }
  const supports = freeze(structuredClone(input).sort((a, b) => a.timestamp - b.timestamp || a.frameId.localeCompare(b.frameId)))
  const brackets: AcquisitionBracket[] = []
  const skipped: Array<{ left: string; right: string; reason: string }> = []
  const timeCounts = new Map<number, number>(), idCounts = new Map<string, number>()
  supports.forEach((s) => {
    timeCounts.set(s.timestamp, (timeCounts.get(s.timestamp) ?? 0) + 1)
    idCounts.set(s.frameId, (idCounts.get(s.frameId) ?? 0) + 1)
  })
  let used = 0
  for (let i = 1; i < supports.length; i++) {
    const left = supports[i - 1], right = supports[i], dt = right.timestamp - left.timestamp
    const valid = (s: AcquisitionSupport) => s.origin !== 'dense' && s.evidence.accepted
      && s.evidence.poseIndex !== null && !!s.evidence.observation
      && s.evidence.observation.timestamp === s.timestamp
      && ((s.origin === 'coarse' && s.diagnosticCode === 'ACCEPTED_TARGET')
        || (s.origin === 'manual-anchor' && s.diagnosticCode === 'USER_SELECTED_ANCHOR'))
    let reason = ''
    if (!valid(left) || !valid(right)) reason = 'UNTRUSTED_OR_BOUNDARY_SUPPORT'
    else if (!Number.isFinite(dt) || dt <= 0 || dt > 1.2) reason = 'UNSUPPORTED_IDENTITY_GAP'
    else if ([left, right].some((s) => timeCounts.get(s.timestamp)! > 1 || idCounts.get(s.frameId)! > 1)) reason = 'DUPLICATE_SUPPORT'
    else if ((left.evidence.observation!.segment ?? 0) !== (right.evidence.observation!.segment ?? 0)) reason = 'SEGMENT_BOUNDARY'
    else if ((left.direction !== right.direction && left.direction !== 'anchor' && right.direction !== 'anchor')
      || (left.direction === 'anchor' && right.direction !== 'forward')
      || (right.direction === 'anchor' && left.direction !== 'backward')) reason = 'DIRECTION_BOUNDARY'
    // A manual anchor is only compatible with the original segment.
    else if ([left, right].some((s) => s.origin === 'manual-anchor')
      && [left, right].some((s) => (s.evidence.observation!.segment ?? 0) !== 0)) reason = 'MANUAL_ANCHOR_BOUNDARY'
    if (reason) { skipped.push({ left: left.frameId, right: right.frameId, reason }); continue }
    const requested = Math.max(0, Math.ceil(dt / cadence) - 1)
    const count = Math.min(requested, perBracketCap, perRunCap - used)
    const timestamps = Array.from({ length: count }, (_, j) => left.timestamp + dt * (j + 1) / (count + 1))
    brackets.push({ id: JSON.stringify([left.frameId, right.frameId]), left, right,
      direction: left.direction === 'anchor' ? 'forward' : left.direction, segment: left.evidence.observation!.segment ?? 0,
      timestamps, requested, incomplete: count < requested })
    used += count
  }
  return freeze({ brackets, skipped, cadence, perBracketCap, perRunCap, planned: used,
    incomplete: brackets.some((b) => b.incomplete) })
}

export type AcquiredTarget = {
  videoId: string | null; runId: string; passId: string; frameId: string; timestamp: number
  acquisitionOrigin: 'dense-trusted-bracket'; bracketId: string
  supportingEndpoints: { left: { frameId: string; timestamp: number }; right: { frameId: string; timestamp: number } }
  direction: 'forward' | 'backward'; segment: number; aspect: number
  status: 'qualified' | 'unusable' | 'unassociated' | 'extraction-failure' | 'detection-failure'
  reasons: string[]; reference: ReferenceObservation | null
  // Full qualified geometry for related-evidence diagnostics only.
  geometry: number[] | null
}
export function assessAcquiredTarget(bracket: AcquisitionBracket, timestamp: number,
  candidates: ReferenceLedgerFrame['candidates'], aspect: number,
  context: { videoId: string | null; runId: string; passId: string },
  failure?: 'extraction-failure' | 'detection-failure'): AcquiredTarget {
  const frameId = context.passId + ':' + bracket.id + ':' + String(timestamp)
  const result: AcquiredTarget = { ...context, frameId, timestamp, acquisitionOrigin: 'dense-trusted-bracket',
    bracketId: bracket.id, supportingEndpoints: {
      left: { frameId: bracket.left.frameId, timestamp: bracket.left.timestamp },
      right: { frameId: bracket.right.frameId, timestamp: bracket.right.timestamp } },
    direction: bracket.direction, segment: bracket.segment, aspect,
    status: failure ?? 'unassociated', reasons: failure ? [failure] : [], reference: null, geometry: null }
  if (failure) return result
  if (!bracket.timestamps.includes(timestamp) || timestamp <= bracket.left.timestamp || timestamp >= bracket.right.timestamp) {
    result.reasons = ['OUTSIDE_FROZEN_SAMPLE_PLAN']; return result
  }
  // Only the two frozen endpoints support association; no harvested history.
  const identity = refineIdentity([bracket.left.evidence.observation!, bracket.right.evidence.observation!], timestamp, candidates, aspect)
  if (!identity.accepted) { result.reasons = [identity.reason]; return result }
  const target = candidates.find((c) => c.poseIndex === identity.poseIndex)!
  const reference = buildReferenceLedger(context.videoId, context.runId, bracket.direction === 'forward' ? bracket.left.timestamp : bracket.right.timestamp,
    aspect, [{ frameId, timestamp, evidence: identity, candidates: [target] }]).records[0]
  result.reference = reference
  result.geometry = reacquisitionGeometry(target.features, aspect)
  result.status = reference.qualification
  result.reasons = [...reference.qualityFailures]
  return result
}

export function relatedAcquiredTargets(observations: AcquiredTarget[]) {
  const qualified = observations.filter((r) => r.status === 'qualified' && r.geometry)
  return qualified.flatMap((a, i) => qualified.slice(i + 1).map((b) => ({
    left: a.frameId, right: b.frameId, temporalDistance: Math.abs(a.timestamp - b.timestamp),
    sharedBracket: a.bracketId === b.bracketId,
    sharedEndpoints: [a.supportingEndpoints.left.frameId, a.supportingEndpoints.right.frameId]
      .filter((id) => id === b.supportingEndpoints.left.frameId || id === b.supportingEndpoints.right.frameId),
    duplicateTimestamp: a.timestamp === b.timestamp,
    sameDetectionSource: a.reference?.detectionSource === b.reference?.detectionSource,
    geometryDistance: Math.sqrt(a.geometry!.reduce((sum, v, j) => sum + (v - b.geometry![j]) ** 2, 0) / a.geometry!.length),
  })))
}

// Local competitor continuity is diagnostic only, never persistent identity.
export type CompetitorProvenanceFrame = ReferenceLedgerFrame & {
  diagnosticCode: string; origin: 'coarse' | 'manual-anchor' | 'dense'
  direction: 'anchor' | 'forward' | 'backward'
}
export type CompetitorObservation = {
  reference: ReferenceObservation; segmentId: string | null
  association: 'locally-associated' | 'new-local-segment' | 'unresolved'
  reason: string; predecessor: string | null
  evidence: Array<{ segmentId: string; accepted: boolean; reason: string; score: number; checks: string[] }>
}
export type CompetitorSegment = {
  id: string; observations: string[]
  termination: { frameId: string | null; reason: string }
}
export function buildCompetitorProvenance(videoId: string | null, runId: string | null, anchorTime: number,
  aspect: number, frames: CompetitorProvenanceFrame[]) {
  const observations: CompetitorObservation[] = [], segments: CompetitorSegment[] = []
  const exclusions: Array<{ frameId: string; reason: string }> = []
  type Track = { segment: CompetitorSegment; history: IdentityObservation[] }
  let active: Track[] = [], previous: CompetitorProvenanceFrame | null = null
  const stop = (frameId: string, reason: string) => {
    active.forEach((t) => { t.segment.termination = { frameId, reason } })
    active = []
  }
  const idCount = new Map<string, number>(), timeCount = new Map<number, number>()
  frames.forEach((f) => {
    if (f.origin === 'dense') return
    idCount.set(f.frameId, (idCount.get(f.frameId) ?? 0) + 1)
    timeCount.set(f.timestamp, (timeCount.get(f.timestamp) ?? 0) + 1)
  })
  // Keep directional streams separate. The anchor seeds forward provenance only;
  // backward observations form their own segments, without duplicating the anchor.
  const ordered = [...frames].sort((a, b) => {
    const ad = a.direction === 'backward', bd = b.direction === 'backward'
    return Number(ad) - Number(bd) || (ad ? b.timestamp - a.timestamp : a.timestamp - b.timestamp) || a.frameId.localeCompare(b.frameId)
  })
  for (const frame of ordered) {
    if (frame.origin === 'dense') { exclusions.push({ frameId: frame.frameId, reason: 'SHADOW_TARGET_NOT_SUPPORT' }); continue }
    const trusted = frame.evidence.accepted && frame.evidence.poseIndex !== null && !!frame.evidence.observation
      && frame.evidence.observation.timestamp === frame.timestamp
      && ((frame.origin === 'coarse' && frame.diagnosticCode === 'ACCEPTED_TARGET')
        || (frame.origin === 'manual-anchor' && frame.diagnosticCode === 'USER_SELECTED_ANCHOR'))
    if (!trusted || !Number.isFinite(frame.timestamp) || idCount.get(frame.frameId)! > 1 || timeCount.get(frame.timestamp)! > 1) {
      const reason = !trusted ? 'TARGET_TRUST_BOUNDARY:' + frame.diagnosticCode : 'INVALID_OR_DUPLICATE_PROVENANCE'
      stop(frame.frameId, reason); exclusions.push({ frameId: frame.frameId, reason }); previous = null
      continue
    }
    if (previous) {
      const dt = Math.abs(frame.timestamp - previous.timestamp)
      if (frame.origin === 'manual-anchor') stop(frame.frameId, 'MANUAL_REANCHOR_BOUNDARY')
      else if ((frame.evidence.observation!.segment ?? 0) !== (previous.evidence.observation!.segment ?? 0)) stop(frame.frameId, 'TARGET_SEGMENT_BOUNDARY')
      else if ((frame.direction === 'backward') !== (previous.direction === 'backward')) stop(frame.frameId, 'DIRECTION_BOUNDARY')
      else if (dt > 1.2 || dt < 0.000001) stop(frame.frameId, 'UNSUPPORTED_TEMPORAL_GAP')
    }
    const candidates = frame.candidates.filter((c) => c.poseIndex !== frame.evidence.poseIndex)
    // Existing detection has already deduplicated crop/full-frame candidates.
    // Duplicate frame-local identifiers are malformed provenance, not extra people.
    const duplicateIds = candidates.some((c, i) => candidates.findIndex((other) => other.poseIndex === c.poseIndex) !== i)
    const rows = buildReferenceLedger(videoId, runId, anchorTime, aspect, [frame]).records.filter((r) => r.role === 'competitor')
    const byId = new Map(rows.map((r) => [r.candidateId, r]))
    // Geometry-derived ordering stabilizes local IDs under candidate/pose-index permutation.
    const sorted = [...candidates].sort((a, b) => a.features.center.x - b.features.center.x
      || a.features.center.y - b.features.center.y || a.features.area - b.features.area
      || JSON.stringify(a.features.landmarks).localeCompare(JSON.stringify(b.features.landmarks)))
    const edges = active.map((track) => sorted.map((candidate) => {
      let diagnostic: IdentityDiagnostic | undefined
      const result = identityStep(track.history, frame.timestamp, [candidate], aspect, (d) => { diagnostic = d })
      return { segmentId: track.segment.id, accepted: result.accepted, reason: result.reason, score: result.score,
        checks: diagnostic?.candidates.flatMap((c) => c.reasons) ?? [] }
    }))
    const outDegree = edges.map((row) => row.filter((e) => e.accepted).length)
    const inDegree = sorted.map((_, j) => edges.filter((row) => row[j].accepted).length)
    const next: Track[] = []
    const continued = new Set<string>()
    const emitted = new Set<number>()
    sorted.forEach((candidate, j) => {
      if (emitted.has(candidate.poseIndex)) return
      emitted.add(candidate.poseIndex)
      const reference = byId.get(frame.frameId + ':' + candidate.poseIndex)!
      const evidence = edges.map((row) => row[j])
      const predecessorIndex = edges.findIndex((row) => row[j].accepted)
      const conflict = duplicateIds || inDegree[j] > 1
        || (predecessorIndex >= 0 && outDegree[predecessorIndex] > 1)
      const seedValid = Number.isFinite(aspect) && aspect > 0
        && Number.isFinite(candidate.features.area) && candidate.features.area > 0
        && Number.isFinite(candidate.features.center.x) && Number.isFinite(candidate.features.center.y)
        && matchPhaseTarget(candidate.features, [candidate]).reliable
      // Seed validation establishes no cross-frame identity.
      if (conflict || !seedValid) {
        observations.push({ reference, segmentId: null, association: 'unresolved',
          reason: duplicateIds ? 'DUPLICATE_CANDIDATE_PROVENANCE' : conflict ? 'COMPETING_ASSIGNMENTS' : 'INSUFFICIENT_SEED_GEOMETRY',
          predecessor: null, evidence })
        return
      }
      if (predecessorIndex >= 0) {
        const track = active[predecessorIndex], predecessor = track.segment.observations[track.segment.observations.length - 1]
        track.segment.observations.push(reference.candidateId)
        next.push({ segment: track.segment, history: [...track.history.slice(-1), { timestamp: frame.timestamp, features: candidate.features }] })
        continued.add(track.segment.id)
        observations.push({ reference, segmentId: track.segment.id, association: 'locally-associated',
          reason: 'UNIQUE_MUTUAL_CONTINUITY', predecessor, evidence })
      } else {
        const segment: CompetitorSegment = { id: 'local-' + segments.length, observations: [reference.candidateId],
          termination: { frameId: null, reason: 'END_OF_OBSERVED_STREAM' } }
        segments.push(segment)
        next.push({ segment, history: [{ timestamp: frame.timestamp, features: candidate.features }] })
        observations.push({ reference, segmentId: segment.id, association: 'new-local-segment',
          reason: active.length ? 'NO_SUPPORTED_PREDECESSOR' : 'NEW_LOCAL_OBSERVATION', predecessor: null, evidence })
      }
    })
    active.forEach((t, i) => {
      if (!continued.has(t.segment.id)) t.segment.termination = { frameId: frame.frameId,
        reason: !candidates.length ? 'MISSED_DETECTION' : outDegree[i] > 1 || edges[i].some((e, j) => e.accepted && inDegree[j] > 1)
          ? 'COMPETING_ASSIGNMENTS' : 'NO_SUPPORTED_CONTINUATION' }
    })
    active = next; previous = frame
  }
  const coverage = observations.filter((o) => o.reference.qualification === 'unusable').map((o) => {
    const r = o.reference, direction = r.direction === 'backward' ? -1 : 1
    // Decision bound is explicit and causal in the corresponding tracking direction.
    const decisions = frames.filter((f) => f.origin !== 'dense' && f.diagnosticCode.startsWith('REACQUISITION_')
      && (f.direction === 'backward' ? -1 : 1) === direction && (f.timestamp - r.timestamp) * direction > 0)
      .sort((a, b) => direction * (a.timestamp - b.timestamp))
    const decision = decisions[0]
    const segment = segments.find((s) => s.id === o.segmentId)
    const position = segment?.observations.indexOf(r.candidateId) ?? -1
    const later = segment?.observations.slice(position + 1).map((id) => observations.find((v) => v.reference.candidateId === id)!) ?? []
    const covering = decision && later.find((v) => v.reference.qualification === 'qualified'
      && (decision.timestamp - v.reference.timestamp) * direction > 0)
    return { observation: r.candidateId, segmentId: o.segmentId, decisionFrame: decision?.frameId ?? null,
      decisionTimestamp: decision?.timestamp ?? null, coveringObservation: covering?.reference.candidateId ?? null,
      path: covering ? segment!.observations.slice(position, segment!.observations.indexOf(covering.reference.candidateId) + 1) : [],
      status: covering ? 'potential-shadow-coverage' : 'unresolved',
      reason: !o.segmentId ? 'UNRESOLVED_COMPETITOR_IDENTITY' : !decision ? 'NO_CAUSAL_DECISION_BOUND'
        : covering ? 'QUALIFIED_LATER_OBSERVATION_ON_CONTINUOUS_LOCAL_PATH' : 'NO_QUALIFIED_CONTINUOUS_REFERENCE_BEFORE_DECISION' }
  })
  return { observations, segments, exclusions, coverage,
    unresolvedObligations: observations.filter((o) => o.association === 'unresolved').map((o) => o.reference.candidateId) }
}
