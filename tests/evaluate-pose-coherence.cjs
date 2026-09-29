// Offline development evaluator. Input is a temporary sanitized measurement file,
// never a video, landmark export, production session or application dependency.
// Usage: node tests/evaluate-pose-coherence.cjs <input.json> <results.json>
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript')
const file = path.resolve(__dirname, '../src/lib/pose-coherence.ts'), model = new Module(file, module)
model._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file)
const statuses = ['NO_OBVIOUS_ANOMALY', 'INSUFFICIENT_EVIDENCE', 'SUSPICIOUS', 'STRONGLY_SUSPICIOUS']
const counts = rows => Object.fromEntries(statuses.map(status => [status, rows.filter(r => r.status === status).length]))
function evaluate(rows) {
  const results = rows.map(row => {
    if (!['id', 'set', 'observation', 'label', 'measurements'].every(k => Object.hasOwn(row, k)) || Object.keys(row).length !== 5) throw Error('Expected sanitized row fields only')
    for (const k of ['id', 'set', 'observation']) if (!/^[a-zA-Z0-9_.-]+$/.test(row[k])) throw Error('Expected anonymous reference ID')
    if (!['COHERENT', 'MALFORMED', 'UNCERTAIN'].includes(row.label)) throw Error('Unexpected reference label')
    const a = model.exports.assessPoseCoherence(row.measurements)
    return { id: row.id, set: row.set, observation: row.observation, label: row.label, status: a.status, reasons: a.reasons }
  })
  // One vote per known coherent physical player/time; no guessed grouping for
  // malformed phantom bodies. Any strong source makes the group strong.
  const coherent = results.filter(r => r.label === 'COHERENT'), grouped = new Map()
  for (const r of coherent) {
    const key = `${r.set}:${r.observation}`, old = grouped.get(key)
    if (!old) grouped.set(key, { ...r, ids: [r.id] })
    else { old.ids.push(r.id); if (statuses.indexOf(r.status) > statuses.indexOf(old.status)) old.status = r.status }
  }
  const distinct = [...grouped.values()].map(({ reasons, id, ...r }) => r)
  const bySet = Object.fromEntries([...new Set(results.map(r => r.set))].map(set => [set, {
    coherentDetections: counts(coherent.filter(r => r.set === set)),
    coherentObservations: counts(distinct.filter(r => r.set === set)),
    malformedDetections: counts(results.filter(r => r.set === set && r.label === 'MALFORMED')),
  }]))
  return { version: 'shadow-v0', authority: 'NONE', aggregation: 'Per set/player/time: STRONGLY_SUSPICIOUS > SUSPICIOUS > INSUFFICIENT_EVIDENCE > NO_OBVIOUS_ANOMALY; adjacent phases remain related, not independent action trials.',
    coherentDetections: counts(coherent), coherentObservations: counts(distinct), bySet, distinct, results }
}
module.exports = { evaluate }
if (require.main === module) {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) throw Error('Provide sanitized input JSON and output JSON paths')
  const result = evaluate(JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, '')))
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ coherentDetections: result.coherentDetections, coherentObservations: result.coherentObservations, bySet: result.bySet }, null, 2))
}
