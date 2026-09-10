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
  return { poseIndex: reliable ? best.poseIndex : null, score: best?.overall ?? 0, margin, reliable }
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

export function detectPhases(input: PhaseCandidate[]): PhaseResult {
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
  for (const c of valid) {
    for (const r of valid) {
      const before = c.timestamp - r.timestamp
      if (before < separation || before > 1.5 || c.outgoing === null) continue
      for (const x of valid) {
        const after = x.timestamp - c.timestamp
        if (after < separation || after > 1.5 || x.outgoing === null) continue
        if (r.outgoing === null || r.outgoing >= c.outgoing * 0.8 || x.outgoing >= c.outgoing * 0.8) continue
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
  if (!best || best.score < 0.4) return unresolved('No supported ordered Ready → Contact → Recovery sequence. Keep manual selection.')
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
