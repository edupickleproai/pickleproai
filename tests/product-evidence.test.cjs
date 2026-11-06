const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

// Use the project's installed TypeScript compiler; no test dependency or output files.
function load(relative, mocks = {}, expose = "") {
  const filename = path.resolve(__dirname, '..', relative)
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  const original = mod.require.bind(mod)
  mod.require = (id) => Object.hasOwn(mocks, id) ? mocks[id] : original(id)
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8') + '\n' + expose, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename)
  return mod.exports
}

const bio = load('src/lib/coaching-biomechanics.ts')
const evidence = load('src/lib/coach-evidence.ts', {'./coaching-biomechanics':bio})
class FakeOpenAI { chat={completions:{create:async()=>({choices:[{message:{content:'Diagnosis: General practice only'}}]})}} }
const mocks={'@/lib/coaching-biomechanics':bio,'@/lib/coach-evidence':evidence,openai:{__esModule:true,default:FakeOpenAI,OpenAI:FakeOpenAI}}
const parse=load('src/app/api/video-analysis/route.ts',mocks,'exports.parse = parseAnalysisResponse').parse
test('missing scores stay unavailable; valid and partial scores survive without fabricated categories',()=>{
 const empty=parse('Technical Diagnosis: Insufficient evidence')
 assert.equal(empty.score,null); assert.ok(Object.values(empty.scoreBreakdown).every(x=>x===null))
 const partial=parse('Score Breakdown:\nFootwork: 8\nPositioning: N/A\nTiming: 11')
 assert.equal(partial.score,8);assert.equal(partial.scoreBreakdown.footwork,8)
 assert.equal(partial.scoreBreakdown.positioning,null);assert.equal(partial.scoreBreakdown.timing,null)
 const full=parse('Score Breakdown:\nFootwork: 8\nPositioning: 6\nPaddle Preparation: 7\nTiming: 9\nConsistency: 5')
 assert.deepEqual(Object.values(full.scoreBreakdown),[8,6,7,9,5]);assert.equal(full.score,7)
})
test('report renders N/A and original images, never illustrative detection overlays',()=>{
 const React=require('react');const {renderToStaticMarkup}=require('react-dom/server')
 let i=0
 const input={score:null,scoreBreakdown:{footwork:8,positioning:null,paddlePrep:null,timing:null,consistency:null},diagnosis:'Insufficient evidence',drills:[],frames:[{label:'Sampled frame 1',src:'data:image/jpeg;base64,YQ=='}]}
 const react={...React,useState:(initial)=>[i++===7?input:initial,()=>{}],useEffect:()=>{},useMemo:fn=>fn()}
 const page=load('src/app/video-review/page.tsx',{'react':react,'@/lib/coaching-biomechanics':bio},'exports.normalize = normalizeVideoFeedback')
 assert.equal(page.normalize({}).score,null)
 assert.equal(page.normalize({scoreBreakdown:{footwork:Infinity}}).scoreBreakdown.footwork,null)
 assert.equal(page.normalize({scoreBreakdown:{footwork:8}}).score,8)
 const html=renderToStaticMarkup(React.createElement(page.default))
 assert.match(html,/N\/A/);assert.match(html,/data:image\/jpeg;base64,YQ==/)
 assert.doesNotMatch(html,/Annotated Frame|Good Contact Point|Move Forward|<canvas/)
 const source=fs.readFileSync('src/app/video-review/page.tsx','utf8')
 assert.doesNotMatch(source,/createAnnotatedSrc|ctx\.ellipse|drawArrow/)
})
test('research page layout blocks production and preserves development children',()=>{
 const prior=process.env.NODE_ENV
 try {const layout=load('src/app/pose-test/layout.tsx',{'next/navigation':{notFound(){throw Error('404')}}}).default
 process.env.NODE_ENV='production';assert.throws(()=>layout({children:'research'}),/404/)
 process.env.NODE_ENV='development';assert.equal(layout({children:'research'}),'research')
 }finally{if(prior===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=prior}
})
test('production APIs ignore forged research evidence; chat has explicit missing-evidence response',async()=>{
 const prior=process.env.NODE_ENV,key=process.env.OPENAI_API_KEY
 try{
 process.env.NODE_ENV='production';process.env.OPENAI_API_KEY='test-only'
 const hostile={...bio,sanitizeCoachingBiomechanicsPayload(){throw Error('untrusted payload consumed')},readVideoBiomechanicsForm(){throw Error('research form consumed')}}
 const coach=load('src/app/api/coach/route.ts',{...mocks,'@/lib/coaching-biomechanics':hostile})
 const response=await coach.POST(new Request('http://localhost/api/coach',{method:'POST',body:JSON.stringify({message:'What did my video show about knee flexion?',coachingBiomechanics:{value:99}})}))
 assert.equal(response.status,200);const text=(await response.json()).text
 assert.match(text,/No coaching-safe/);assert.doesNotMatch(text,/99/)
 const video=load('src/app/api/video-analysis/route.ts',{...mocks,'@/lib/coaching-biomechanics':hostile})
 const form=new FormData();form.set('coachingBiomechanics','{"value":99}')
 const result=await video.POST(new Request('http://localhost/api/video-analysis',{method:'POST',body:form}))
 assert.equal(result.status,400)
 }finally{if(prior===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=prior;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key}
})
