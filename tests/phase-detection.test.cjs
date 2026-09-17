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
