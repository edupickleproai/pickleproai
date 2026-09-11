const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
const path = require('node:path')
const filename = path.resolve(__dirname, '../src/lib/phase-detection.ts')
const mod = new Module(filename, module)
mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename)
const { detectPhases, matchPhaseTarget, phaseGeometry, overridePhase, scorePlayerMatch, planPhaseRefinement, refinePhases, selectMixedPhases } = mod.exports
const clip = () => [0.4, 0.4, 0.7, 1.5, 0.7, 0.4, 0.4].map((reach, i) => ({ frameId: `f${i}`, timestamp: i * 0.2, targetScore: 0.98, matched: true, reach, wrist: { x: reach, y: 0 } }))
const player = (x) => ({ center: { x, y: 0.5 }, area: 0.08, landmarks: Array.from({ length: 33 }, () => ({ x, y: 0.5, visibility: 0.95 })) })

test('ordered solver selects unique frames around the action peak with explanations', () => {
  const result = detectPhases(clip())
  assert.equal(result.proposals.length, 3)
  const [r, c, x] = result.proposals
  assert.ok(r.timestamp < c.timestamp && c.timestamp < x.timestamp)
  assert.equal(new Set(result.proposals.map((p) => p.frameId)).size, 3)
  assert.equal(c.frameId, 'f3')
  assert.ok(result.proposals.every((p) => p.reasons.length && Number.isFinite(p.score)))
})
test('matching follows physical geometry despite changed pose indices and candidate order', () => {
  for (const [targetIndex, otherIndex] of [[1, 2], [3, 1], [2, 4]]) {
    const match = matchPhaseTarget(player(0.25), [{ poseIndex: otherIndex, features: player(0.75) }, { poseIndex: targetIndex, features: player(0.26) }])
    assert.equal(match.poseIndex, targetIndex)
    assert.equal(match.reliable, true)
  }
  assert.equal(scorePlayerMatch(player(0.25), player(0.25)).overall, 1)
})
test('missing or ambiguous target never inherits another pose index', () => {
  assert.equal(matchPhaseTarget(player(0.25), [{ poseIndex: 1, features: player(0.75) }]).poseIndex, null)
  assert.equal(matchPhaseTarget(player(0.25), [{ poseIndex: 1, features: player(0.25) }, { poseIndex: 2, features: player(0.26) }]).poseIndex, null)
  const frames = clip(); frames[3].matched = false
  assert.ok(detectPhases(frames).proposals.every((p) => p.frameId !== 'f3'))
})
test('insufficient, static, occluded and sparse evidence is unresolved', () => {
  assert.equal(detectPhases(clip().slice(0, 2)).proposals.length, 0)
  assert.equal(detectPhases(clip().map((f) => ({ ...f, reach: 1, wrist: { x: 1, y: 0 } }))).proposals.length, 0)
  assert.equal(detectPhases(clip().map((f) => ({ ...f, matched: false }))).proposals.length, 0)
  assert.equal(detectPhases(clip().map((f) => ({ ...f, timestamp: f.timestamp * 10 }))).proposals.length, 0)
})
test('manual phase replacement preserves unrelated auto selections', () => {
  const current = { ready: 'auto-r', contact: 'auto-c', recovery: 'auto-x' }
  for (const phase of ['ready', 'contact', 'recovery']) {
    const changed = overridePhase(current, phase, 'manual')
    assert.equal(changed[phase], 'manual')
    for (const other of ['ready', 'contact', 'recovery'].filter((p) => p !== phase)) assert.equal(changed[other], current[other])
  }
  assert.equal(current.contact, 'auto-c')
})
test('scoring is deterministic including shuffled candidate input', () => {
  assert.deepEqual(detectPhases(clip()), detectPhases(clip().reverse()))
})
test('duplicate IDs and invalid coordinates cannot fabricate a phase', () => {
  assert.equal(detectPhases(clip().map((f) => ({ ...f, frameId: 'duplicate' }))).proposals.length, 0)
  assert.equal(detectPhases(clip().map((f) => ({ ...f, wrist: { x: NaN, y: 0 } }))).proposals.length, 0)
})
test('geometry requires visible arm and torso and ignores experimental world data', () => {
  const lm = player(0.3).landmarks
  lm[11] = { x: 0.2, y: 0.3, visibility: 1 }; lm[12] = { x: 0.4, y: 0.3, visibility: 1 }
  assert.ok(phaseGeometry(lm, 16 / 9, 'right').reach !== null)
  lm[16].visibility = 0.1
  assert.equal(phaseGeometry(lm, 16 / 9, 'right').reach, null)
})

test('compact strokes use motion onset and deceleration without demanding maximum reach', () => {
  const result = detectPhases([0, 0.1, 0.8, 0.83, 0.85].map((x, i) => ({ frameId: `c${i}`, timestamp: 10 + i * 0.5, matched: true, targetScore: 0.95, reach: 1, wrist: { x, y: 0 } })))
  assert.deepEqual(result.proposals.map((p) => p.frameId), ['c0', 'c1', 'c2'])
  assert.ok(result.proposals.every((p) => p.confidence === 'low'))
})

test('similarly plausible separate strokes remain low-confidence', () => {
  const frames = [...clip(), ...clip().map((f) => ({ ...f, frameId: `second-${f.frameId}`, timestamp: f.timestamp + 3 }))]
  const result = detectPhases(frames)
  assert.equal(result.proposals.length, 3)
  assert.ok(result.proposals.every((p) => p.confidence === 'low'))
  assert.match(result.reasons[0], /Multiple action peaks/)
})

const localFixture = (plateau = false) => {
  const coarse = { proposals: ['ready', 'contact', 'recovery'].map((phase, i) => ({ phase, frameId: `coarse-${i}`, timestamp: 1 + i * 0.6, score: 0.6, confidence: 'medium', reasons: [] })), candidates: [], reasons: [] }
  const plan = planPhaseRefinement(coarse.proposals, 4)
  let x = 0
  const candidates = plan.windows.flatMap((w) => w.timestamps).map((timestamp, i, times) => {
    if (i) {
      const previous = times[i - 1]
      const speed = Math.abs(previous - 1.68) < 1e-6 || (plateau && Math.abs(previous - 1.76) < 1e-6) ? 3 : Math.abs(previous - 1.6) < 1e-6 ? 1 : 0.05
      x += speed * (timestamp - previous)
    }
    return { frameId: `dense-${i}`, timestamp, targetScore: 0.98, matched: true, reach: 1, wrist: { x, y: 0 } }
  })
  return { coarse, plan, candidates }
}

test('refinement plan samples only bounded local windows with bounded work', () => {
  const { plan, coarse } = localFixture()
  assert.equal(plan.interval, 0.08)
  for (const w of plan.windows) {
    assert.ok(w.timestamps.includes(w.coarseTimestamp))
    assert.ok(w.timestamps.every((t) => t >= w.start && t <= w.end && Math.abs(t - w.coarseTimestamp) <= 0.45 + 1e-6))
    assert.ok(w.timestamps.length <= 17)
  }
  assert.deepEqual(planPhaseRefinement(coarse.proposals, 400), plan)
})
test('a stronger local action replaces coarse Contact inside its window', () => {
  const { coarse, candidates, plan } = localFixture()
  const result = refinePhases(coarse, candidates, plan)
  assert.ok(result.details[1].accepted, JSON.stringify(result.details))
  assert.ok(Math.abs(result.proposals[1].timestamp - 1.68) < 1e-6)
  result.proposals.forEach((p, i) => assert.ok(p.timestamp >= plan.windows[i].start && p.timestamp <= plan.windows[i].end))
})
test('refined phases remain ordered and separated', () => {
  const { coarse, candidates, plan } = localFixture()
  const result = refinePhases(coarse, candidates, plan)
  assert.ok(result.proposals[1].timestamp - result.proposals[0].timestamp >= 0.12)
  assert.ok(result.proposals[2].timestamp - result.proposals[1].timestamp >= 0.12)
})
test('refined phase frames remain unique', () => {
  const { coarse, candidates, plan } = localFixture()
  assert.equal(new Set(refinePhases(coarse, candidates, plan).proposals.map((p) => p.frameId)).size, 3)
})
test('TARGET_A mismatch cannot win local refinement', () => {
  const { coarse, candidates, plan } = localFixture()
  const wrong = candidates.find((f) => Math.abs(f.timestamp - 1.68) < 1e-6)
  wrong.matched = false
  assert.ok(refinePhases(coarse, candidates, plan).proposals.every((p) => p.frameId !== wrong.frameId))
})
test('weak or missing local evidence retains the coarse sequence', () => {
  const { coarse, candidates, plan } = localFixture()
  for (const input of [[], candidates.map((f) => ({ ...f, wrist: { x: 0, y: 0 } }))]) {
    const result = refinePhases(coarse, input, plan)
    assert.deepEqual(result.proposals, coarse.proposals)
    assert.ok(result.details.every((d) => !d.accepted))
  }
})
test('competing local action candidates retain coarse timing with low confidence', () => {
  const { coarse, candidates, plan } = localFixture(true)
  // Equal incoming/outgoing speeds at two consecutive action samples create a plateau.
  let x = 0
  candidates.forEach((f, i) => {
    if (i) x += (candidates[i - 1].timestamp >= 1.6 - 1e-6 && candidates[i - 1].timestamp <= 1.76 + 1e-6 ? 3 : 0.05) * (f.timestamp - candidates[i - 1].timestamp)
    f.wrist.x = x
  })
  const result = refinePhases(coarse, candidates, plan)
  assert.ok(result.proposals.every((p) => p.confidence === 'low'), JSON.stringify(result))
  assert.ok(result.details.every((d) => !d.accepted))
})
test('local refinement is deterministic even with shuffled observations', () => {
  const { coarse, candidates, plan } = localFixture()
  assert.deepEqual(refinePhases(coarse, candidates, plan), refinePhases(coarse, [...candidates].reverse(), plan))
})
test('neighbor boundaries and off-grid action cannot pull refinement into another phase', () => {
  const { coarse, candidates, plan } = localFixture()
  assert.ok(plan.windows[1].start - plan.windows[0].end >= 0.12 - 1e-6)
  assert.ok(plan.windows[2].start - plan.windows[1].end >= 0.12 - 1e-6)
  const extra = { ...candidates[0], frameId: 'outside', timestamp: 3.5, wrist: { x: 100, y: 0 }, reach: 100 }
  assert.deepEqual(refinePhases(coarse, [...candidates, extra], plan), refinePhases(coarse, candidates, plan))
})
test('missing dense samples cannot be bridged as reliable local motion', () => {
  const { coarse, candidates, plan } = localFixture()
  const result = refinePhases(coarse, candidates.filter((f) => Math.abs(f.timestamp - 1.68) > 1e-6), plan)
  assert.ok(result.details.every((d) => !d.accepted))
})

test('dense baseline can be evaluated when coarse timing fails the finer action gate', () => {
  const { coarse, candidates, plan } = localFixture()
  let x = 0
  candidates.forEach((f, i) => {
    if (i) x += (Math.abs(candidates[i - 1].timestamp - 1.68) < 1e-6 ? 3 : 0.05) * (f.timestamp - candidates[i - 1].timestamp)
    f.wrist.x = x
  })
  const bounds = Object.fromEntries(coarse.proposals.map((p) => [p.phase, { start: p.timestamp - 1e-6, end: p.timestamp + 1e-6 }]))
  assert.equal(detectPhases(candidates, bounds).proposals.length, 0)
  const result = refinePhases(coarse, candidates, plan)
  assert.ok(result.comparison.every((c) => c.validCandidates > 1))
  assert.ok(result.details[1].accepted)
  assert.ok(Math.abs(result.proposals[1].timestamp - 1.68) < 1e-6)
  candidates.find((f) => Math.abs(f.timestamp - 1.6) < 1e-6).matched = false
  assert.ok(refinePhases(coarse, candidates, plan).details.every((d) => !d.accepted))
})

test('matching diagnostics distinguish missing, wrong-player and ambiguous evidence without relaxing identity', () => {
  assert.equal(matchPhaseTarget(player(0.25), []).rejection, 'no pose')
  assert.equal(matchPhaseTarget(player(0.25), [{ poseIndex: 1, features: player(0.75) }]).rejection, 'low score')
  const ambiguous = matchPhaseTarget(player(0.25), [{ poseIndex: 3, features: player(0.25) }, { poseIndex: 1, features: player(0.26) }])
  assert.equal(ambiguous.rejection, 'ambiguous')
  assert.equal(ambiguous.poseIndex, null)
  assert.ok(ambiguous.secondScore > 0.9)
})

const mixedFixture = (gains) => {
  const baseline = ['ready', 'contact', 'recovery'].map((phase, i) => ({ phase, frameId: `base-${i}`, timestamp: 1 + i * 0.6, score: 0.6, confidence: 'low', reasons: [] }))
  const challengers = baseline.map((p, i) => ({ ...p, frameId: `new-${i}`, timestamp: p.timestamp + 0.08, score: p.score + gains[i] }))
  return { baseline, challengers }
}
test('Ready regression does not block Contact improvement', () => {
  const { baseline, challengers } = mixedFixture([-0.1, 0.2, 0])
  assert.deepEqual(selectMixedPhases(baseline, challengers).map((p) => p.frameId), ['base-0', 'new-1', 'base-2'])
})
test('Ready regression does not block Recovery improvement', () => {
  const { baseline, challengers } = mixedFixture([-0.1, 0, 0.2])
  assert.deepEqual(selectMixedPhases(baseline, challengers).map((p) => p.frameId), ['base-0', 'base-1', 'new-2'])
})
test('one improved phase can coexist with two coarse baselines', () => {
  const { baseline, challengers } = mixedFixture([0.1, 0.01, -0.1])
  assert.deepEqual(selectMixedPhases(baseline, challengers).map((p) => p.frameId), ['new-0', 'base-1', 'base-2'])
})
test('two improved phases coexist with regressing Ready retained', () => {
  const { baseline, challengers } = mixedFixture([-0.067, 0.452, 0.126])
  assert.deepEqual(selectMixedPhases(baseline, challengers).map((p) => p.frameId), ['base-0', 'new-1', 'new-2'])
})
test('all three safely improving phases can refine', () => {
  const { baseline, challengers } = mixedFixture([0.04, 0.1, 0.2])
  assert.deepEqual(selectMixedPhases(baseline, challengers), challengers)
})
test('temporal ordering retains coarse instead of an otherwise better crossing challenger', () => {
  const { baseline, challengers } = mixedFixture([0.1, 0, 0])
  challengers[0].timestamp = baseline[1].timestamp
  assert.deepEqual(selectMixedPhases(baseline, challengers), baseline)
})
test('duplicate refined identity is never selected twice', () => {
  const { baseline, challengers } = mixedFixture([0.1, 0.2, 0])
  challengers[0].frameId = challengers[1].frameId
  const result = selectMixedPhases(baseline, challengers)
  assert.equal(new Set(result.map((p) => p.frameId)).size, 3)
  assert.equal(result[0].frameId, baseline[0].frameId)
  assert.equal(result[1].frameId, challengers[1].frameId)
})
test('mixed selection is deterministic independent of input phase order', () => {
  const { baseline, challengers } = mixedFixture([-0.1, 0.2, 0.1])
  assert.deepEqual(selectMixedPhases(baseline, challengers), selectMixedPhases([...baseline].reverse(), [...challengers].reverse()))
})
test('all worse challengers preserve coarse fallback', () => {
  const { baseline, challengers } = mixedFixture([-0.1, -0.2, -0.01])
  assert.deepEqual(selectMixedPhases(baseline, challengers), baseline)
})
