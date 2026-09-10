const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
const path = require('node:path')
const filename = path.resolve(__dirname, '../src/lib/phase-detection.ts')
const mod = new Module(filename, module)
mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename)
const { detectPhases, matchPhaseTarget, phaseGeometry, overridePhase, scorePlayerMatch } = mod.exports
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
