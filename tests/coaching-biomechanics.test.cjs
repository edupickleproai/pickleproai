const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

// Use the project's installed TypeScript compiler; no test dependency or output files.
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relative)
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  const original = mod.require.bind(mod)
  mod.require = (id) => Object.hasOwn(mocks, id) ? mocks[id] : original(id)
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename)
  return mod.exports
}
const bio = load('src/lib/coaching-biomechanics.ts')
const evidence = load('src/lib/coach-evidence.ts', { './coaching-biomechanics': bio })
const metric = (overrides = {}) => ({ metric: 'leftKneeFlexion', value: 30, unit: 'degrees', status: 'coaching_eligible', warnings: [], ...overrides })
const payload = (metrics = [metric()]) => ({ schemaVersion: '1.0', source: { kind: 'pose-test', videoFingerprint: 'A.mp4:3:100' }, phases: [{ phase: 'ready', metrics }, { phase: 'contact', metrics: [] }, { phase: 'recovery', metrics: [] }], comparisons: [] })
const clean = bio.sanitizeCoachingBiomechanicsPayload
const canonical = (value, overrides = {}) => ({ value, unit: '°', source: 'image', coachingEligible: true, ...overrides })

test('eligible values survive; exact whitelist strips all nested raw/debug fields', () => {
  const p = payload([metric({ landmarks: ['SECRET'], worldLandmarks: ['SECRET'], diagnostics: { orientation: 'SECRET' }, cropDiagnostics: 'SECRET' })])
  p.debug = 'SECRET'
  p.source.notes = 'SECRET'
  p.phases[0].raw = 'SECRET'
  assert.deepEqual(clean(p), payload())
  assert.doesNotMatch(bio.formatCoachingBiomechanicsForPrompt(p), /SECRET|diagnostics|landmarks/)
})
test('review status and warnings survive, including absent reason and inconsistent eligible status', () => {
  for (const overrides of [
    { status: 'coaching_eligible_review', warnings: ['large_phase_change'] },
    { status: 'coaching_eligible_review', warnings: [] },
    { warnings: ['large_phase_change'] },
  ]) {
    const p = clean(payload([metric(overrides)]))
    assert.equal(p.phases[0].metrics[0].status, 'coaching_eligible_review')
    assert.ok(p.phases[0].metrics[0].warnings.length)
    assert.match(bio.formatCoachingBiomechanicsForPrompt(p), /REVIEW: interpret cautiously/)
  }
})
test('invalid numeric, unsupported, unreliable, experimental and malformed values fail closed', () => {
  for (const value of [NaN, Infinity, -Infinity, -1, 181, null, '30', {}, []]) assert.equal(clean(payload([metric({ value })])), null)
  for (const overrides of [
    { status: 'NOT RELIABLE' }, { status: 'N/A' }, { metric: 'worldKneeFlexion' },
    { unit: 'x' }, { source: 'world' }, { coachingEligible: false }, { experimental: true },
    { reliability: 'Low' }, { warnings: {} }, { warnings: 'large_phase_change' }, { warnings: [null] },
  ]) assert.equal(clean(payload([metric(overrides)])), null)
  for (const p of [null, [], {}, 'bad', { ...payload(), schemaVersion: '0.9' }, { ...payload(), phases: {} }]) assert.equal(clean(p), null)
})
test('ambiguous duplicate phase and metric values are excluded', () => {
  assert.equal(clean(payload([metric(), metric({ value: 80 })])), null)
  const p = payload(); p.phases.push(p.phases[0]); assert.equal(clean(p), null)
})
test('canonical rules preserve image source, units, eligibility and orientation compatibility', () => {
  const evalMetric = (a, b, name = 'leftKneeFlexion') => bio.evaluateCoachingComparison(a, b, name)
  assert.equal(evalMetric(canonical(20), canonical(40)).delta, 20)
  for (const overrides of [{ source: 'world' }, { unit: 'meters' }, { coachingEligible: false }, { value: NaN }]) {
    assert.equal(evalMetric(canonical(20), canonical(40, overrides)).delta, null)
  }
  assert.equal(evalMetric(canonical(20), canonical(30), 'torsoLean').delta, null)
  const geometry = (x) => ({ orientationSignature: { shoulderSpanToTorso: x, hipSpanToTorso: x } })
  assert.equal(evalMetric(canonical(20, { diagnostics: geometry(1) }), canonical(30, { diagnostics: geometry(2) }), 'torsoLean').delta, null)
  assert.equal(evalMetric(canonical(20, { diagnostics: geometry(1) }), canonical(30, { diagnostics: geometry(1.1) }), 'torsoLean').delta, 10)
})
test('comparisons require compatible endpoints and accurate delta; large knee change retains review', () => {
  const p = bio.buildCoachingBiomechanicsPayload({ ready: { kneeLeft: canonical(20) }, contact: { kneeLeft: canonical(90) }, recovery: null }, 'A.mp4:3:100')
  assert.equal(clean(p).comparisons[0].status, 'coaching_eligible_review')
  assert.equal(clean(p).phases[1].metrics[0].status, 'coaching_eligible_review')
  for (const changes of [{ delta: 900 }, { delta: NaN }, { compatibility: undefined }, { fromPhase: 'recovery' }, { source: 'world' }]) {
    const q = structuredClone(p); Object.assign(q.comparisons[0], changes)
    assert.equal(clean(q).comparisons.length, 0)
  }
  const q = structuredClone(p); q.phases[1].metrics = []
  assert.equal(clean(q).comparisons.length, 0)
})
test('storage handles missing, invalid, outdated JSON and denied storage without throwing', () => {
  for (const raw of [null, '{', 'null', '{}', JSON.stringify({ ...payload(), schemaVersion: '2.0' })]) {
    assert.equal(bio.readStoredCoachingBiomechanics(() => ({ getItem: () => raw })), null)
  }
  assert.equal(bio.readStoredCoachingBiomechanics(() => { throw Error('denied') }), null)
})
test('clearing a video only removes that video and never another tab\'s result', () => {
  let removed = false
  const storage = () => ({ getItem: () => JSON.stringify(payload()), removeItem: () => { removed = true } })
  bio.clearStoredVideoBiomechanics(storage, 'B.mp4:3:100')
  assert.equal(removed, false)
  bio.clearStoredVideoBiomechanics(storage, null)
  assert.equal(removed, false)
  bio.clearStoredVideoBiomechanics(storage, 'A.mp4:3:100')
  assert.equal(removed, true)
})
test('review notice is deterministic even when the AI omits uncertainty', () => {
  const p = payload([metric({ status: 'coaching_eligible_review' })])
  assert.match(bio.addCoachingReviewNotice('Diagnosis:\nAdvice\nDrills:\nPractice', p), /^Diagnosis:\s*Biomechanics review required:/)
  assert.match(bio.addCoachingReviewNotice('Advice', p), /^Biomechanics review required:/)
  assert.equal(bio.addCoachingReviewNotice('Advice', payload()), 'Advice')
})
test('same-video cross-tab storage attaches only sanitized data; video B and missing provenance omit it', () => {
  let stored = JSON.stringify(payload())
  const sharedStorage = () => ({ getItem: (key) => { assert.equal(key, 'picklepro:coaching-biomechanics:v1'); return stored } })
  const file = new File(['abc'], 'A.mp4', { lastModified: 100, type: 'video/mp4' })
  const form = new FormData(); form.set('video', file)
  bio.appendVideoBiomechanics(form, file, sharedStorage)
  assert.deepEqual(bio.readVideoBiomechanicsForm(form), payload())
  const other = new File(['def'], 'B.mp4', { lastModified: 100 })
  form.set('video', other)
  // A malicious/stale client bypassing client matching is still rejected by server.
  assert.equal(bio.readVideoBiomechanicsForm(form), null)
  bio.appendVideoBiomechanics(form, other, sharedStorage)
  assert.equal(form.has('coachingBiomechanics'), false)
  stored = JSON.stringify({ ...payload(), source: { kind: 'pose-test', videoFingerprint: null } })
  assert.equal(bio.appendVideoBiomechanics(form, file, sharedStorage), null)
  form.delete('videoLastModified')
  assert.equal(bio.readVideoBiomechanicsForm(form), null)
})

test('both real API handlers independently sanitize before OpenAI prompt construction', async () => {
  const requests = []
  class FakeOpenAI {
    chat = { completions: { create: async (request) => {
      requests.push(request)
      return { choices: [{ message: { content: JSON.stringify({ playerId: 'TARGET_A', description: 'test player', confidence: 0.9, diagnosis: 'test' }) } }] }
    } } }
  }
  const { EventEmitter } = require('node:events')
  const fakeFs = { mkdirSync() {}, existsSync() { return true }, promises: {
    writeFile: async () => {}, readFile: async () => Buffer.from('test image'), readdir: async () => ['frame_0001.jpg'], rm: async () => {},
  } }
  const mocks = {
    '@/lib/coaching-biomechanics': bio,
    '@/lib/coach-evidence': evidence,
    openai: { __esModule: true, default: FakeOpenAI, OpenAI: FakeOpenAI },
    fs: fakeFs,
    sharp: () => ({ resize() { return this }, jpeg() { return this }, toBuffer: async () => Buffer.from('test image') }),
    child_process: { spawn: () => { const p = new EventEmitter(); p.stderr = new EventEmitter(); process.nextTick(() => p.emit('close', 0)); return p } },
  }
  const previous = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-only'
  try {
    const coach = load('src/app/api/coach/route.ts', mocks)
    const video = load('src/app/api/video-analysis/route.ts', mocks)
    const p = payload([metric({ status: 'coaching_eligible_review', warnings: ['large_phase_change'], worldLandmarks: 'SECRET' }), metric({ metric: 'torsoLean', value: 10, status: 'NOT RELIABLE' })])
    p.diagnostics = 'SECRET'
    const response = await coach.POST(new Request('http://localhost/api/coach', { method: 'POST', body: JSON.stringify({ message: 'Help', coachingBiomechanics: p }) }))
    assert.equal(response.status, 200)
    assert.match((await response.json()).text, /Biomechanics review required/)
    assert.match(JSON.stringify(requests.at(-1)), /Left knee flexion = 30.0/)
    assert.match(JSON.stringify(requests.at(-1)), /REVIEW/)
    assert.doesNotMatch(JSON.stringify(requests.at(-1)), /SECRET|Torso lean =/)
    for (const name of ['A.mp4', 'B.mp4']) {
      requests.length = 0
      const form = new FormData()
      form.set('video', new File(['abc'], name, { lastModified: 100 }))
      form.set('videoLastModified', '100')
      form.set('coachingBiomechanics', JSON.stringify(p))
      form.set('notes', 'Test')
      const result = await video.POST(new Request('http://localhost/api/video-analysis', { method: 'POST', body: form }))
      assert.equal(result.status, 200)
      const resultBody = await result.json()
      if (name === 'A.mp4') assert.match(resultBody.analysis.diagnosis, /Biomechanics review required/)
      else assert.doesNotMatch(resultBody.analysis.diagnosis, /Biomechanics review required/)
      const prompt = JSON.stringify(requests)
      assert.doesNotMatch(prompt, /SECRET|Torso lean =/)
      if (name === 'A.mp4') assert.match(prompt, /Left knee flexion = 30.0/)
      else assert.doesNotMatch(prompt, /Left knee flexion =/)
    }
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previous
  }
})

const recoveryOnly = () => ({
  schemaVersion: '1.0', source: { kind: 'pose-test', videoFingerprint: 'A.mp4:3:100' },
  phases: [
    { phase: 'ready', metrics: [metric({ value: 99, status: 'NOT RELIABLE' })] },
    { phase: 'contact', metrics: [metric({ value: 88, status: 'N/A' })] },
    { phase: 'recovery', metrics: [
      metric({ value: 46.8 }), metric({ metric: 'rightKneeFlexion', value: 7.7 }),
      metric({ metric: 'torsoLean', value: 18.5 }),
      metric({ metric: 'stanceWidth', value: 2, unit: 'ratio', status: 'NOT RELIABLE' }),
      metric({ metric: 'shoulderTiltMagnitude', value: 5, status: 'NOT RELIABLE' }),
    ] },
  ], comparisons: [],
})

test('video-specific question starts with trusted observations and single-phase limits even if AI is generic', () => {
  const context = evidence.buildCoachEvidence('What should I improve first based on this video?', recoveryOnly())
  const answer = evidence.groundCoachResponse('Diagnosis:\nGeneric advice.\n\nDrills:\nPractice.', context)
  assert.match(answer, /^Diagnosis:\s*Observation: In the Recovery frame/)
  for (const value of ['46.8', '7.7', '18.5']) assert.ok(answer.includes(value))
  assert.match(answer, /Ready and Contact measurements are unavailable/)
  assert.match(answer, /single frame cannot establish a pattern/)
  assert.match(answer, /do not establish a technical fault/)
  assert.ok(answer.indexOf('Observation:') < answer.indexOf('Interpretation:'))
  assert.doesNotMatch(answer, /99|88|stance width 2|shoulder tilt magnitude 5/)
})

test('knee question prioritizes matching metrics and forbids fault or persistence conclusions', () => {
  const context = evidence.buildCoachEvidence('What did you notice about my knee flexion?', recoveryOnly())
  assert.match(context.prompt, /left knee flexion 46.8 degrees/)
  assert.match(context.prompt, /right knee flexion 7.7 degrees/)
  assert.doesNotMatch(context.prompt, /torso lean 18.5|Torso lean =|stance width 2/)
  assert.match(context.prompt, /left\/right difference in one frame is not proof/)
  assert.match(context.prompt, /not a flexibility or strength test/)
})

test('insufficient comparison evidence bounds the entire answer even when the model prescribes a correction', () => {
  const unsafe = 'Diagnosis:\nYour recovery is imbalanced.\nDrills:\nEqualize knee flexion.\nPractical Tip:\nBend both knees more evenly.'
  for (const question of ['What should I improve first based on this video?', 'What did you notice about my knee flexion?', 'What did you notice about my torso lean?', 'What did you notice about my stance width?']) {
    const answer = evidence.groundCoachResponse(unsafe, evidence.buildCoachEvidence(question, recoveryOnly()))
    assert.doesNotMatch(answer, /is imbalanced|Equalize knee flexion|Bend both knees more evenly/)
    assert.match(answer, /Frame-and-repeat check/)
    assert.match(answer, /reliability checks/)
    if (question.includes('stance width')) assert.doesNotMatch(answer, /46.8|7.7|18.5/)
    else assert.match(answer, /before choosing a technique change/)
  }
})

test('unavailable requested metric or phase does not borrow another measurement', () => {
  for (const question of ['What did you notice about my stance width?', 'What was my knee flexion at Contact?']) {
    const context = evidence.buildCoachEvidence(question, recoveryOnly())
    assert.match(context.observation, /No coaching-safe.*measurement is available/)
    assert.doesNotMatch(context.prompt, /46.8|7.7|18.5/)
    assert.match(context.prompt, /cannot make a measured observation/)
  }
  const context = evidence.buildCoachEvidence('What did you notice in this video?', null)
  assert.match(context.observation, /cannot make a measured observation/)
})

test('review measurements retain explicit uncertainty in observation, prompt, and final answer', () => {
  const p = recoveryOnly(); p.phases[2].metrics[0].status = 'coaching_eligible_review'
  const context = evidence.buildCoachEvidence('What about my left knee?', p)
  assert.match(context.observation, /46.8 degrees \(REVIEW: uncertain; verify/)
  assert.match(context.prompt, /advice based on it must be conditional/)
  const answer = bio.addCoachingReviewNotice(evidence.groundCoachResponse('Diagnosis:\nAdvice.', context), p)
  assert.match(answer, /Biomechanics review required/)
  assert.match(answer, /REVIEW: uncertain/)
})

test('the real Coach API sends evidence before profile advice and returns a grounded answer', async () => {
  const requests = []
  class FakeCoach {
    chat = { completions: { create: async (request) => {
      requests.push(request)
      return { choices: [{ message: { content: 'Diagnosis:\nConsider another repetition.\nDrills:\n- **Target Practice** — Practice.' } }] }
    } } }
  }
  const route = load('src/app/api/coach/route.ts', {
    '@/lib/coaching-biomechanics': bio, '@/lib/coach-evidence': evidence,
    openai: { __esModule: true, default: FakeCoach },
  })
  const previous = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'test-only'
  try {
    for (const question of ['What should I improve first based on this video?', 'What did you notice about my knee flexion?', 'What did you notice about my stance width?']) {
      const response = await route.POST(new Request('http://localhost/api/coach', {
        method: 'POST', body: JSON.stringify({ message: question, goals: 'Improve consistency', coachingBiomechanics: recoveryOnly() }),
      }))
      const answer = (await response.json()).text
      const request = requests.at(-1)
      assert.equal(response.status, 200)
      assert.match(request.messages[0].content, /evidence takes priority over profile goals/)
      assert.ok(request.messages[1].content.indexOf('VIDEO-EVIDENCE QUESTION') < request.messages[1].content.indexOf('Secondary tailoring context'))
      assert.match(answer, /Observation:/)
      if (question.includes('stance width')) assert.doesNotMatch(answer, /46.8|7.7|18.5/)
      else assert.match(answer, /In the Recovery frame/)
      assert.doesNotMatch(request.messages[1].content, /99|88|Stance width =|Shoulder tilt magnitude =/)
    }
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previous
  }
})

test('Coach markdown renders emphasis and lists without executing raw HTML', async () => {
  const markdown = await import('react-markdown')
  const Component = load('src/app/coach/CoachMarkdown.tsx', { 'react-markdown': { __esModule: true, default: markdown.default } }).default
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const html = renderToStaticMarkup(React.createElement(Component, null, '- **Target Practice** — Practice.\n\n<script>alert(1)</script>'))
  assert.match(html, /<strong>Target Practice<\/strong>/)
  assert.match(html, /<ul>/)
  assert.doesNotMatch(html, /\*\*Target Practice\*\*|<script/)
})
