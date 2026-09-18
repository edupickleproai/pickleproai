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
const { planCoarseSampling } = mod.exports
for (const [duration, count] of [[15.77, 29], [21.20, 39], [24.20, 44], [34.60, 63], [38.15, 70]]) {
  test(`adaptive sampling supplies local motion for ${duration}s`, () => {
    const plan = planCoarseSampling(duration)
    assert.equal(plan.frameCount, count)
    assert.equal(plan.motionCompatible, true)
    assert.ok(plan.interval <= 0.55 && plan.interval < 0.8)
    const result = detectPhases(plan.timestamps.map((timestamp, i) => ({
      frameId: `f${i}`, timestamp, targetScore: 1, matched: true,
      reach: 1, wrist: { x: i % 3, y: 0 },
    })))
    assert.ok(result.candidates.every((c) => c.motion !== null))
  })
}
test('short clips use only four samples, ordered uniquely inside the video', () => {
  const plan = planCoarseSampling(1)
  assert.equal(plan.frameCount, 4)
  assert.deepEqual(plan.timestamps, [0.125, 0.375, 0.625, 0.875])
})
test('sampling scales deterministically with duration', () => {
  const durations = [1, 5, 15, 30, 60]
  const counts = durations.map((d) => planCoarseSampling(d).frameCount)
  assert.deepEqual(counts, [4, 10, 28, 55, 110])
  for (const d of durations) assert.deepEqual(planCoarseSampling(d), planCoarseSampling(d))
})
test('cap bounds work while reporting compatible capped coverage honestly', () => {
  const plan = planCoarseSampling(80)
  assert.equal(plan.frameCount, 120)
  assert.equal(plan.timestamps.length, 120)
  assert.equal(plan.capped, true)
  assert.equal(plan.motionCompatible, true)
})
test('cap exceeding motion limit explicitly reports insufficient coverage', () => {
  for (const duration of [96, 120, 3600]) {
    const plan = planCoarseSampling(duration)
    assert.equal(plan.frameCount, 120)
    assert.equal(plan.motionCompatible, false)
    assert.match(plan.reason, /Insufficient sampling coverage/)
    assert.match(plan.reason, /unresolved/)
  }
})
test('invalid duration fails closed without allocating frames', () => {
  for (const duration of [0, -1, NaN, Infinity]) {
    const plan = planCoarseSampling(duration)
    assert.equal(plan.frameCount, 0)
    assert.equal(plan.motionCompatible, false)
    assert.deepEqual(plan.timestamps, [])
  }
})
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

const { identityStep, trackIdentity, refineIdentity, identitySequenceAllowed } = mod.exports
const observation = (t, x, area = 0.08) => ({ timestamp: t, features: { ...player(x), area } })
const detection = (index, x, area = 0.08) => ({ poseIndex: index, features: { ...player(x), area } })
test('identity follows changing indices through normal movement beyond original anchor', () => {
  const frames = Array.from({length: 9}, (_, i) => ({ frameId: 'id'+i, timestamp: (i+1)*0.5, candidates: [detection([3,1,2][i%3], 0.2+(i+1)*0.035)] }))
  const result = trackIdentity(observation(0,0.2), frames, 1)
  assert.ok([...result.values()].every(e=>e.accepted))
  assert.equal(result.get('id8').poseIndex,2)
})
test('identity permits gradual scale change', () => {
  const e=identityStep([observation(0,0.2)],0.5,[detection(3,0.22,0.095)],1)
  assert.equal(e.accepted,true)
})
test('best positional score cannot override predicted trajectory', () => {
  const e=identityStep([observation(0,0.2),observation(0.5,0.27)],1,[detection(1,0.27),detection(3,0.34)],1)
  // Two geometrically plausible people: abstain rather than choose by score.
  assert.equal(e.accepted,false)
  assert.match(e.reason,/Ambiguous/)
})
test('crossing ambiguity locks continuity instead of transferring it later', () => {
  const result=trackIdentity(observation(0,0.3),[
    {frameId:'cross',timestamp:0.5,candidates:[detection(1,0.31),detection(2,0.34)]},
    {frameId:'after',timestamp:1,candidates:[detection(2,0.31)]}],1)
  assert.equal(result.get('cross').accepted,false)
  assert.equal(result.get('after').accepted,false)
})
test('disappearance does not substitute a distant teammate', () => {
  assert.equal(identityStep([observation(0,0.2)],0.5,[detection(1,0.5)],1).accepted,false)
})
test('brief disappearance can reacquire only a unique consistent observation', () => {
  const result=trackIdentity(observation(0,0.2),[
    {frameId:'missing',timestamp:0.5,candidates:[]},
    {frameId:'return',timestamp:1,candidates:[detection(3,0.22)]}],1)
  assert.equal(result.get('missing').accepted,false)
  assert.equal(result.get('return').accepted,true)
})
test('long gap cannot reacquire a teammate occupying the original anchor', () => {
  const result=trackIdentity(observation(0,0.2),[
    {frameId:'gone',timestamp:0.5,candidates:[]},
    {frameId:'replacement',timestamp:2,candidates:[detection(2,0.2)]},
    {frameId:'later',timestamp:2.5,candidates:[detection(2,0.2)]}],1)
  assert.ok([...result.values()].every(e=>!e.accepted))
})
test('weak visibility, scale discontinuity and malformed geometry fail closed', () => {
  const weak=detection(1,0.2);weak.features.landmarks[11].visibility=0.1
  for(const candidate of [weak,detection(1,0.2,0.2),detection(1,NaN)])
    assert.equal(identityStep([observation(0,0.2)],0.5,[candidate],1).accepted,false)
})
test('identity propagates backward from an interior anchor deterministically', () => {
  const frames=[{frameId:'left',timestamp:0.5,candidates:[detection(3,0.27)]},{frameId:'right',timestamp:1.5,candidates:[detection(2,0.33)]}]
  const a=trackIdentity(observation(1,0.3),frames,1)
  assert.ok([...a.values()].every(e=>e.accepted))
  assert.deepEqual(a,trackIdentity(observation(1,0.3),frames.slice().reverse(),1))
})
test('refinement requires agreeing identity evidence on both temporal sides', () => {
  const refs=[observation(0,0.2),observation(1,0.24)]
  assert.equal(refineIdentity(refs,0.5,[detection(3,0.22)],1).accepted,true)
  assert.equal(refineIdentity(refs,1.5,[detection(3,0.24)],1).accepted,false)
  assert.equal(refineIdentity(refs,0.5,[detection(3,0.22),detection(2,0.24)],1).accepted,false)
})
test('identity-rejected or missing phases block acceptance and biomechanics authorization', () => {
  const valid=identityStep([observation(0,0.2)],0.5,[detection(3,0.22)],1)
  const evidence=new Map([['r',valid],['c',valid],['x',valid]])
  assert.equal(identitySequenceAllowed(['r','c','x'],id=>evidence.get(id)),true)
  evidence.set('c',{accepted:false,poseIndex:null,score:0,reason:'identity lost'})
  assert.equal(identitySequenceAllowed(['r','c','x'],id=>evidence.get(id)),false)
  assert.equal(identitySequenceAllowed(['r','missing','x'],id=>evidence.get(id)),false)
  assert.equal(identitySequenceAllowed(['r','r','x'],id=>evidence.get(id)),false)
})
test('page guards both phase acceptance and automatic biomechanics before side effects', () => {
  const source=fs.readFileSync(path.resolve(__dirname,'../src/app/pose-test/page.tsx'),'utf8')
  assert.equal(ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX).parseDiagnostics.length,0)
  const accept=source.slice(source.indexOf('const acceptAutomaticPhases'),source.indexOf('const analyzeAcceptedPhases'))
  const analyze=source.slice(source.indexOf('const analyzeAcceptedPhases'),source.indexOf('const handleDetectPose'))
  assert.ok(accept.indexOf('identitySequenceAllowed') < accept.indexOf('setSelectedFrameByPhase'))
  assert.ok(analyze.indexOf('identitySequenceAllowed') < analyze.indexOf('await handleDetectPose'))
  assert.match(analyze,/biomechanics blocked/)
})

const observeStep = (history, time, candidates) => {
  let diagnostic
  const result = identityStep(history, time, candidates, 1, d => { diagnostic = d })
  assert.deepEqual(result, identityStep(history, time, candidates, 1))
  return { result, diagnostic }
}
test('observability: zero detections is explicit, without changing rejection', () => {
  const {diagnostic, result} = observeStep([observation(0,0.2)],0.5,[])
  assert.equal(diagnostic.code,'NO_POSE_DETECTED')
  assert.equal(diagnostic.evaluated,0)
  assert.equal(result.reason,'No motion-consistent TARGET_A observation')
})
test('observability: rejected candidates retain all geometric failure reasons', () => {
  const {diagnostic} = observeStep([observation(0,0.2)],0.5,[detection(2,0.8,0.3)])
  assert.equal(diagnostic.code,'NO_PLAUSIBLE_TARGET')
  assert.equal(diagnostic.evaluated,1)
  assert.equal(diagnostic.plausible,0)
  assert.deepEqual(diagnostic.candidates[0].reasons,['IDENTITY_TRAJECTORY_REJECTED','IDENTITY_SCALE_REJECTED'])
})
test('observability: plausible pose failing integrity is distinct from no candidate', () => {
  const weak=detection(7,0.22); weak.features.landmarks[11].visibility=0.1
  const {diagnostic} = observeStep([observation(0,0.2)],0.5,[weak])
  assert.equal(diagnostic.code,'IDENTITY_POSE_REJECTED')
  assert.equal(diagnostic.plausible,1)
  assert.deepEqual(diagnostic.candidates[0].reasons,['MATCH_TORSO_VISIBILITY'])
})
test('observability: ambiguity has candidates and locks continuity', () => {
  const {diagnostic} = observeStep([observation(0,0.2)],0.5,[detection(1,0.21),detection(2,0.22)])
  assert.equal(diagnostic.code,'AMBIGUOUS_CANDIDATES')
  assert.equal(diagnostic.ambiguity,true)
  assert.equal(diagnostic.plausible,2)
  assert.equal(diagnostic.continuity,'locked')
})
test('observability: accepted target and per-frame index remain diagnostic only', () => {
  for (const index of [1,7,23]) {
    const {diagnostic,result} = observeStep([observation(0,0.2)],0.5,[detection(index,0.22)])
    assert.equal(diagnostic.code,'ACCEPTED_TARGET')
    assert.equal(result.accepted,true)
    assert.equal(result.poseIndex,index)
    assert.equal(diagnostic.candidates[0].poseIndex,index)
  }
})
test('observability: gap rejection differs from subsequent continuity lockout', () => {
  const diagnostics=new Map()
  const frames=[{frameId:'gap',timestamp:2,candidates:[detection(1,0.2)]},{frameId:'locked',timestamp:2.5,candidates:[detection(2,0.2)]}]
  trackIdentity(observation(0,0.2),frames,1,(id,d)=>diagnostics.set(id,d))
  assert.equal(diagnostics.get('gap').code,'UNSUPPORTED_IDENTITY_GAP')
  assert.equal(diagnostics.get('locked').code,'CONTINUITY_LOCKED')
  assert.equal(diagnostics.get('locked').evaluated,0)
  assert.deepEqual(diagnostics.get('locked').candidates,[])
})
test('observability: tracking and downstream phase outputs unchanged with observer', () => {
  const frames=Array.from({length:9},(_,i)=>({frameId:`audit${i}`,timestamp:(i+1)*0.5,candidates:[detection(i%3+1,0.2+(i+1)*0.035)]}))
  const before=trackIdentity(observation(0,0.2),frames,1)
  const diagnostics=[]
  const after=trackIdentity(observation(0,0.2),frames,1,(_,d)=>diagnostics.push(d))
  assert.deepEqual(after,before)
  assert.equal(diagnostics.length,9)
  const toPhases = map => frames.map((f,i)=>({frameId:f.frameId,timestamp:f.timestamp,matched:map.get(f.frameId).accepted,targetScore:map.get(f.frameId).score,reach:1+i%3,wrist:{x:i%3,y:0}}))
  assert.deepEqual(detectPhases(toPhases(after)),detectPhases(toPhases(before)))
  assert.ok(diagnostics.every(d=>!JSON.stringify(d).includes('landmarks')))
})
test('observability: missing identity reference is not a fabricated detection failure', () => {
  const {diagnostic} = observeStep([],0.5,[])
  assert.equal(diagnostic.code,'MISSING_IDENTITY_REFERENCE')
  assert.equal(diagnostic.evaluated,0)
})

// Reacquisition fixtures encode pose configuration, not appearance or pose IDs.
const { evaluateReacquisition } = mod.exports
function rqPlayer(x=0.3, teammate=false) {
  const landmarks=Array.from({length:33},()=>({x,y:0.5,visibility:1}))
  const joints={11:[-.05,.3],12:[.05,.3],13:[-.08,teammate?.2:.4],14:[.08,teammate?.2:.4],15:[-.12,teammate?.12:.48],16:[.12,teammate?.12:.48],23:[-.04,.5],24:[.04,.5],25:[-.05,.65],26:[.05,.65],27:[-.06,.8],28:[.06,.8]}
  for(const [id,[dx,y]] of Object.entries(joints)) landmarks[id]={x:x+dx,y,visibility:1}
  return {center:{x,y:.55},area:.08,landmarks}
}
const rqTrusted=()=>[{timestamp:0,features:rqPlayer()},{timestamp:.55,features:rqPlayer(.31)}]
const rqNegatives=()=>[rqPlayer(.8,true)]
const rqCandidate=(poseIndex=1,x=.6,teammate=false)=>({poseIndex,features:rqPlayer(x,teammate)})
const rqStep=(time,candidates,hypothesis=null)=>evaluateReacquisition(rqTrusted(),rqNegatives(),time,candidates,1,hypothesis)
const rqRun=(frames)=>{
  const diagnostics=new Map()
  const evidence=trackIdentity({timestamp:0,features:rqPlayer()},[
    {frameId:'trusted',timestamp:.55,candidates:[rqCandidate(1,.31)]},
    {frameId:'gap',timestamp:2,candidates:[]},...frames],1,(id,d)=>diagnostics.set(id,d),{competitors:rqNegatives()})
  return {evidence,diagnostics}
}
test('reacquisition: no detection remains locked',()=>{
  const r=rqStep(3,[])
  assert.equal(r.diagnostic.code,'REACQUISITION_NO_CANDIDATE')
  assert.equal(r.evidence.accepted,false)
  assert.equal(r.hypothesis,null)
})
test('reacquisition: incompatible pose is rejected without using old position',()=>{
  const r=rqStep(3,[rqCandidate(1,.3,true)])
  assert.equal(r.evidence.accepted,false)
  assert.equal(r.diagnostic.code,'REACQUISITION_REJECTED')
  assert.ok(r.diagnostic.candidates[0].reasons.includes('REACQUISITION_TARGET_GEOMETRY'))
})
test('reacquisition: one compatible frame is only a pending hypothesis',()=>{
  const r=rqStep(3,[rqCandidate()])
  assert.equal(r.diagnostic.code,'REACQUISITION_PENDING_CONFIRMATION')
  assert.equal(r.diagnostic.confirmation.count,1)
  assert.equal(r.evidence.poseIndex,null)
  assert.equal(r.evidence.observation,undefined)
})
test('reacquisition: three observations confirm despite changed pose indices',()=>{
  let r=rqStep(3,[rqCandidate(7)])
  r=rqStep(3.55,[rqCandidate(2,.61)],r.hypothesis)
  assert.equal(r.evidence.accepted,false)
  r=rqStep(4.10,[rqCandidate(9,.62)],r.hypothesis)
  assert.equal(r.diagnostic.code,'REACQUISITION_CONFIRMED')
  assert.equal(r.evidence.poseIndex,9)
  assert.equal(r.evidence.observation.timestamp,4.1)
  assert.equal(r.diagnostic.confirmation.count,3)
})
test('reacquisition: a different local trajectory resets the hypothesis',()=>{
  const a=rqStep(3,[rqCandidate(1,.6)])
  const b=rqStep(3.55,[rqCandidate(1,.2)],a.hypothesis)
  assert.equal(b.diagnostic.code,'REACQUISITION_HYPOTHESIS_RESET')
  assert.equal(b.evidence.accepted,false)
  assert.equal(b.hypothesis,null)
})
test('reacquisition: similarly plausible competitors abstain and reset',()=>{
  const a=rqStep(3,[rqCandidate()])
  const b=rqStep(3.55,[rqCandidate(1,.61),rqCandidate(2,.8)],a.hypothesis)
  assert.equal(b.diagnostic.code,'REACQUISITION_AMBIGUOUS')
  assert.equal(b.diagnostic.ambiguity,true)
  assert.equal(b.hypothesis,null)
})
test('reacquisition: YouTube-style only-teammate availability never suffices',()=>{
  const frames=Array.from({length:12},(_,i)=>({frameId:'teammate'+i,timestamp:12+i*.55,candidates:[rqCandidate(i%3+1,.3,true)]}))
  const {evidence}=rqRun(frames)
  for(const f of frames) assert.equal(evidence.get(f.frameId).accepted,false)
})
test('reacquisition: indistinguishable target and teammate evidence stays locked',()=>{
  let h=null
  for(const t of [3,3.55,4.1,4.65]) {
    const r=evaluateReacquisition(rqTrusted(),[rqPlayer(.8)],t,[rqCandidate()],1,h)
    assert.equal(r.evidence.accepted,false)
    assert.ok(r.diagnostic.candidates[0].reasons.includes('REACQUISITION_COMPETITOR_SEPARATION'))
    h=r.hypothesis
  }
})
test('reacquisition: trusted stream resumes only at confirmation; no backfill',()=>{
  const frames=[2.55,3.10,3.65,4.20].map((timestamp,i)=>({frameId:'return'+i,timestamp,candidates:[rqCandidate(i+1,.6+i*.01)]}))
  const {evidence,diagnostics}=rqRun(frames)
  assert.equal(evidence.get('return0').accepted,false)
  assert.equal(evidence.get('return1').accepted,false)
  assert.equal(evidence.get('return2').accepted,true)
  assert.equal(evidence.get('return3').accepted,true)
  assert.equal(diagnostics.get('return2').continuity,'reacquired')
  assert.equal(diagnostics.get('return3').code,'ACCEPTED_TARGET')
  assert.equal(evidence.get('return2').observation.segment,1)
})
test('reacquisition: pending and rejected observations cannot authorize biomechanics',()=>{
  const pending=rqStep(3,[rqCandidate()]).evidence
  const rejected=rqStep(3,[rqCandidate(1,.3,true)]).evidence
  assert.equal(identitySequenceAllowed(['a','b','c'],()=>pending),false)
  assert.equal(identitySequenceAllowed(['a','b','c'],()=>rejected),false)
  const result=detectPhases([pending,rejected,pending].map((e,i)=>({frameId:'p'+i,timestamp:i*.55,matched:e.accepted,targetScore:e.score,reach:2,wrist:{x:i,y:0}})))
  assert.equal(result.proposals.length,0)
})
test('reacquisition: refinement cannot backfill across the untrusted gap',()=>{
  const refs=[...rqTrusted(),{timestamp:2,features:rqPlayer(.32),segment:1}]
  const r=refineIdentity(refs,1.1,[rqCandidate(1,.32)],1)
  assert.equal(r.accepted,false)
  assert.match(r.reason,/reacquisition boundary/)
})
test('reacquisition: opting in leaves pre-lockout decisions and diagnostics identical',()=>{
  const anchor={timestamp:0,features:rqPlayer()}
  const frames=Array.from({length:6},(_,i)=>({frameId:'same'+i,timestamp:(i+1)*.55,candidates:[rqCandidate(i%3+1,.3+(i+1)*.01)]}))
  const before=[],after=[]
  const a=trackIdentity(anchor,frames,1,(_,d)=>before.push(d))
  const b=trackIdentity(anchor,frames,1,(_,d)=>after.push(d),{competitors:rqNegatives()})
  assert.deepEqual(a,b)
  assert.deepEqual(before,after)
})
test('reacquisition: anchor alone or absent competitor reference fails closed',()=>{
  for(const [trusted,negatives] of [[rqTrusted().slice(0,1),rqNegatives()],[rqTrusted(),[]]]) {
    const r=evaluateReacquisition(trusted,negatives,3,[rqCandidate()],1)
    assert.equal(r.diagnostic.code,'REACQUISITION_NOT_ATTEMPTED_INSUFFICIENT_REFERENCE')
    assert.equal(r.evidence.accepted,false)
  }
})
test('reacquisition: poor visibility and malformed geometry cannot confirm',()=>{
  for(const mutate of [f=>f.landmarks[11].visibility=.1,f=>f.landmarks[15].x=NaN]) {
    const candidate=rqCandidate();mutate(candidate.features)
    const r=rqStep(3,[candidate])
    assert.equal(r.evidence.accepted,false)
    assert.equal(r.diagnostic.code,'REACQUISITION_AMBIGUOUS')
    assert.ok(r.diagnostic.candidates[0].reasons.includes('REACQUISITION_POSE_QUALITY'))
  }
})
test('reacquisition: missing samples and excessive confirmation intervals reset',()=>{
  const a=rqStep(3,[rqCandidate()])
  assert.equal(rqStep(4,[rqCandidate()],a.hypothesis).diagnostic.code,'REACQUISITION_HYPOTHESIS_RESET')
  assert.equal(rqStep(3.55,[],a.hypothesis).hypothesis,null)
})
test('reacquisition: deterministic candidate ordering and safe backward confirmation',()=>{
  const frames=[3,2.45,1.9]
  let a=null,b=null
  for(const t of frames) {
    const candidates=[rqCandidate(7),rqCandidate(4,.9,true)]
    const x=rqStep(t,candidates,a),y=rqStep(t,candidates.slice().reverse(),b)
    assert.deepEqual(x.evidence,y.evidence)
    a=x.hypothesis;b=y.hypothesis
    if(t===1.9) assert.equal(x.evidence.accepted,true)
  }
})

test('prerequisites: insufficient target count is explicit',()=>{
  const q=evaluateReacquisition(rqTrusted().slice(0,1),rqNegatives(),3,[rqCandidate()],1).diagnostic.prerequisites
  assert.deepEqual(q.reasons,['INSUFFICIENT_USABLE_TARGET_REFERENCES','INSUFFICIENT_UNIQUE_TARGET_REFERENCES'])
  assert.deepEqual(q.target,{available:1,unique:1,usable:1,required:2})
})
test('prerequisites: missing competitor is explicit',()=>{
  const q=evaluateReacquisition(rqTrusted(),[],3,[rqCandidate()],1).diagnostic.prerequisites
  assert.deepEqual(q.reasons,['INSUFFICIENT_COMPETITOR_REFERENCES'])
  assert.equal(q.competitor.available,0)
  assert.equal(q.competitor.required,1)
})
test('prerequisites: simultaneous failures are preserved',()=>{
  const q=evaluateReacquisition([],[],NaN,[rqCandidate()],1).diagnostic.prerequisites
  assert.deepEqual(q.reasons,['INVALID_REACQUISITION_TIMESTAMP','INSUFFICIENT_USABLE_TARGET_REFERENCES','INSUFFICIENT_UNIQUE_TARGET_REFERENCES','INSUFFICIENT_COMPETITOR_REFERENCES'])
})
test('prerequisites: sufficient references remain eligible and pending',()=>{
  const r=rqStep(3,[rqCandidate()])
  assert.equal(r.diagnostic.prerequisites.eligible,true)
  assert.deepEqual(r.diagnostic.prerequisites.reasons,[])
  assert.equal(r.diagnostic.code,'REACQUISITION_PENDING_CONFIRMATION')
})
test('prerequisites: counts reflect deduplication and unusable geometry',()=>{
  const refs=rqTrusted();refs[1].features.landmarks[15].visibility=.2
  const q=evaluateReacquisition([...refs,refs[0]],rqNegatives(),3,[rqCandidate()],1).diagnostic.prerequisites
  assert.deepEqual(q.target,{available:3,unique:2,usable:1,required:2})
  assert.ok(q.reasons.includes('TARGET_REFERENCES_UNUSABLE'))
  assert.deepEqual(q.references[1].reasons,['LANDMARK_15_INSUFFICIENT_VISIBILITY'])
})
test('prerequisites: every competitor must be usable; all quality failures exposed',()=>{
  const bad=rqPlayer();bad.area=0;bad.landmarks[11].x=NaN;bad.landmarks[12].visibility=.1
  const q=evaluateReacquisition(rqTrusted(),[...rqNegatives(),bad],3,[rqCandidate()],1).diagnostic.prerequisites
  assert.deepEqual(q.competitor,{available:2,usable:1,required:1,allUsable:false})
  assert.deepEqual(q.reasons,['COMPETITOR_REFERENCES_UNUSABLE'])
  assert.deepEqual(q.references.at(-1).reasons,['INVALID_AREA','LANDMARK_11_INVALID_COORDINATES','LANDMARK_12_INSUFFICIENT_VISIBILITY'])
})
test('prerequisites: unused bad target reference does not block sufficient good references',()=>{
  const bad=rqPlayer();bad.area=0
  const r=evaluateReacquisition([...rqTrusted(),{timestamp:1,features:bad}],rqNegatives(),3,[rqCandidate()],1)
  assert.equal(r.diagnostic.prerequisites.eligible,true)
  assert.equal(r.diagnostic.prerequisites.target.usable,2)
  assert.equal(r.diagnostic.code,'REACQUISITION_PENDING_CONFIRMATION')
})
test('prerequisites: no-candidate precedence remains unchanged',()=>{
  const r=evaluateReacquisition([],[],NaN,[],0)
  assert.equal(r.diagnostic.code,'REACQUISITION_NO_CANDIDATE')
  assert.equal(r.diagnostic.prerequisites,undefined)
})
test('prerequisites: degenerate torso and limb report their actual failure',()=>{
  for(const [mutate,reason] of [
    [f=>{f.landmarks[23]={...f.landmarks[11]};f.landmarks[24]={...f.landmarks[12]}},'TORSO_TOO_SHORT'],
    [f=>{f.landmarks[13]={...f.landmarks[11]}},'LIMB_11_13_TOO_SHORT'],
  ]) {
    const bad=rqPlayer();mutate(bad)
    const q=evaluateReacquisition(rqTrusted(),[bad],3,[rqCandidate()],1).diagnostic.prerequisites
    assert.deepEqual(q.references.at(-1).reasons,[reason])
    assert.equal(q.eligible,false)
  }
})

const { buildReferenceLedger } = mod.exports
function ledgerFrame(time=0, index=1, reason='User-selected physical player anchor') {
  const features=rqPlayer()
  return {frameId:'f'+time,timestamp:time,candidates:[{poseIndex:index,features,detectionSource:'FULL_FRAME'},{poseIndex:9,features:rqPlayer(.8,true)}],
    evidence:{accepted:true,poseIndex:index,score:1,reason,observation:{timestamp:time,features,segment:0}}}
}
const ledger=(frames)=>buildReferenceLedger('video','run',0,1,frames)
test('ledger: trusted target and manual anchor provenance are explicit',()=>{
  const r=ledger([ledgerFrame()]).records[0]
  assert.equal(r.identityStatus,'trusted-target'); assert.equal(r.physicalIdentity,'TARGET_A')
  assert.equal(r.acceptanceOrigin,'User-selected physical player anchor')
  assert.equal(r.videoId,'video'); assert.equal(r.runId,'run'); assert.equal(r.direction,'anchor')
})
test('ledger: existing geometry qualifies target without authorization changes',()=>{
  assert.equal(ledger([ledgerFrame()]).qualifiedTargets.length,1)
})
test('ledger: low-quality accepted target remains trusted but unusable',()=>{
  const f=ledgerFrame(); f.candidates[0].features.landmarks[13].visibility=.2
  const r=ledger([f]).records[0]
  assert.equal(r.identityStatus,'trusted-target'); assert.equal(r.qualification,'unusable')
  assert.equal(r.shadowReferenceEligible,false)
  assert.deepEqual(r.qualityFailures,['LANDMARK_13_INSUFFICIENT_VISIBILITY'])
})
for(const state of ['REACQUISITION_PENDING_CONFIRMATION','REACQUISITION_REJECTED','UNRESOLVED']) {
  test('ledger: excludes '+state,()=>{
    const f=ledgerFrame(); f.evidence={accepted:false,poseIndex:null,score:0,reason:state}
    assert.equal(ledger([f]).records.length,0)
  })
}
test('ledger: unusable competitors retained with exact failures and unresolved identity',()=>{
  const f=ledgerFrame(); f.candidates[1].features.landmarks[15].visibility=.1
  const r=ledger([f]).records[1]
  assert.equal(r.qualification,'unusable'); assert.equal(r.physicalIdentity,null)
  assert.equal(r.identityStatus,'unresolved-competitor')
  assert.deepEqual(r.qualityFailures,['LANDMARK_15_INSUFFICIENT_VISIBILITY'])
})
test('ledger: competitors never acquire persistent identity across timestamps',()=>{
  const rows=ledger([ledgerFrame(),ledgerFrame(.55)]).records.filter(r=>r.role==='competitor')
  assert.equal(rows.length,2); assert.ok(rows.every(r=>r.physicalIdentity===null))
  assert.notEqual(rows[0].candidateId,rows[1].candidateId)
})
test('ledger: pose permutation changes only frame-local candidate label',()=>{
  const a=ledger([ledgerFrame()]).records[0], b=ledger([ledgerFrame(0,7)]).records[0]
  assert.notEqual(a.candidateId,b.candidateId)
  assert.deepEqual({...a,candidateId:null},{...b,candidateId:null})
})
test('ledger: repeated frames and deduplicated candidates do not inflate view',()=>{
  const f=ledgerFrame(); f.candidates.push(f.candidates[0])
  assert.equal(ledger([f,f]).qualifiedTargets.length,1)
  const other=ledgerFrame(); other.frameId='alternate-source'
  assert.equal(ledger([f,other]).qualifiedTargets.length,1)
})
test('ledger: direction segment and missing source preserved honestly',()=>{
  const f=ledgerFrame(-.55); f.evidence.observation.segment=-1
  const r=ledger([f]).records
  assert.equal(r[0].direction,'backward'); assert.equal(r[0].segment,-1)
  assert.equal(r[1].detectionSource,null)
  assert.equal(ledger([ledgerFrame(.55)]).records[0].direction,'forward')
})
test('ledger: pure collection cannot alter tracking or scorer inputs',()=>{
  const f=ledgerFrame(), before=JSON.stringify(f)
  const prior=rqStep(3,[rqCandidate()])
  ledger([f])
  assert.equal(JSON.stringify(f),before)
  assert.deepEqual(rqStep(3,[rqCandidate()]),prior)
})
test('ledger: confirmed target retained but pending history and confirmation negatives not enrolled',()=>{
  const rows=ledger([ledgerFrame(3,1,'REACQUISITION_CONFIRMED')]).records
  assert.equal(rows.length,1); assert.equal(rows[0].role,'target')
})
test('checkpoint equivalence: tracking lock reacquisition and phases unchanged',()=>{
  const {execFileSync}=require('node:child_process')
  const source=execFileSync('git',['show','ac157033e80bf1fee3008a07c88b8dac3d452a70:src/lib/phase-detection.ts'],{encoding:'utf8'})
  const baseline=new Module(filename,module)
  baseline._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,filename)
  const frames=[{frameId:'trusted',timestamp:.55,candidates:[rqCandidate(1,.31)]},{frameId:'gap',timestamp:2,candidates:[]},
    ...[3,3.55,4.1].map((timestamp,i)=>({frameId:'r'+i,timestamp,candidates:[rqCandidate(i+2,.6+i*.01)]}))]
  const run=(m)=>{const d=[]; const e=m.trackIdentity({timestamp:0,features:rqPlayer()},frames,1,(id,v)=>d.push([id,v]),{competitors:rqNegatives()}); return {e:[...e],d}}
  assert.deepEqual(run(mod.exports),run(baseline.exports))
  for(const candidates of [[],[rqCandidate()],[rqCandidate(2,.6,true)],[rqCandidate(),rqCandidate(4)]])
    assert.deepEqual(rqStep(3,candidates),baseline.exports.evaluateReacquisition(rqTrusted(),rqNegatives(),3,candidates,1))
  const phases=Array.from({length:12},(_,i)=>({frameId:'p'+i,timestamp:i*.55,targetScore:1,matched:true,reach:Math.sin(i)+2,wrist:{x:i*.1,y:Math.sin(i)}}))
  assert.deepEqual(detectPhases(phases),baseline.exports.detectPhases(phases))
})
