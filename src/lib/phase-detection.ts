export type Phase = 'ready' | 'contact' | 'recovery'
export type Landmark = { x: number; y: number; visibility?: number }
export type PlayerFeatures = { center: { x: number; y: number }; area: number; landmarks: Landmark[] }

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
