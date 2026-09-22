const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript')
const {execFileSync}=require('node:child_process')
function load(file,mocks={}){const name=path.resolve(__dirname,'..',file),m=new Module(name,module);m.filename=name;m.paths=module.paths;m.require=id=>id in mocks?mocks[id]:require(id);m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,name);return m.exports}
const helpers=load('src/lib/pose-research.ts')
const {measurePose,researchId,labelResearch}=helpers
const pose=Array.from({length:33},(_,i)=>({x:.2+(i%3)*.08,y:.1+i*.02,visibility:.9}))
test('fixed measurements deterministic and do not mutate input',()=>{const before=JSON.stringify(pose);assert.deepEqual(measurePose(pose,576,1024),measurePose(pose,576,1024));assert.equal(JSON.stringify(pose),before)})
test('raw crop uses physical aspect and remapping preserves shape',()=>{const crop=measurePose(pose,332,1024),mapped=measurePose(pose.map(p=>({...p,x:(p.x*332+244)/576})),576,1024);for(const key of ['torsoLength','bboxAspect','torsoAngle','sideVectorCosine','torsoBboxDiagonal','maxSinglePointAreaInfluence'])assert.ok(Math.abs(crop[key]-mapped[key])<1e-10,key);crop.limbTorsoRatios.forEach((v,i)=>assert.ok(Math.abs(v-mapped.limbTorsoRatios[i])<1e-10));assert.ok(Math.abs(crop.bboxArea*332/576-mapped.bboxArea)<1e-10)})
test('invalid and degenerate geometry abstains numerically without classifying',()=>{assert.ok(measurePose([],100,100).unavailable);const m=measurePose(pose.map(p=>({...p,x:0,y:0})),100,100);assert.equal(m.torsoBboxDiagonal,null);assert.equal(m.limbTorsoRatios[0],null);assert.equal(m.classification,undefined)})
test('pose indices are frame/video/source local metadata',()=>{assert.notEqual(researchId('v','f1','FULL_FRAME',1,'raw'),researchId('v','f2','FULL_FRAME',1,'raw'));assert.notEqual(researchId('v','f1','FULL_FRAME',1,'raw'),researchId('v','f1','LEFT_CROP',1,'raw'))})
test('labels update only the requested research row immutably',()=>{const rows=[{id:'a',label:'UNLABELED',note:''},{id:'b',label:'UNLABELED',note:''}];const next=labelResearch(rows,'a','COHERENT','visual review');assert.equal(rows[0].label,'UNLABELED');assert.equal(next[1],rows[1]);assert.equal(next[0].label,'COHERENT')})

test('real component frame selection, detection and labeling have no product-state outputs',async()=>{
  const slots=[];let index=0
  const react={useState:init=>{const i=index++;if(!(i in slots))slots[i]=init;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]},useRef:init=>{const i=index++;if(!(i in slots))slots[i]={current:init};return slots[i]}}
  const jsx=(type,props)=>({type,props})
  const Component=load('src/app/pose-test/RawPoseResearch.tsx',{'react':react,'react/jsx-runtime':{jsx,jsxs:jsx},'@/lib/pose-research':helpers}).default
  const product={tracking:['anchor'],ledger:['reference'],reacquisition:[],phases:{ready:'f1'},biomechanics:{},coaching:{}}
  const before=JSON.stringify(product)
  const frame=Object.freeze({frameId:'f2',timestampSeconds:2,imageDataUrl:'data:frame'})
  const record={poseIndex:7,raw:{source:'LEFT_CROP',passPose:2,input:'data:crop',width:332,height:1024,sx:244,fullWidth:576,landmarks:pose},final:{poseIndex:7,landmarks:pose,bbox:{left:0,top:0,width:1,height:1}},retained:true,suppressedBy:null,overlaps:[]}
  let called=0
  const props={video:'test',videoUrl:'blob:test',fingerprint:'v',frames:[frame],busy:false,detect:async()=>{called++;return{sourceImage:frame.imageDataUrl,records:[record]}}}
  const render=()=>{index=0;return Component(props)}
  const find=(tree,predicate)=>{if(!tree||typeof tree!=='object')return; if(predicate(tree))return tree;for(const c of [tree.props?.children].flat(Infinity)){const found=find(c,predicate);if(found)return found}}
  let tree=render();find(tree,n=>n.props?.['aria-label']==='Research frame').props.onChange({target:{value:'f2'}})
  tree=render()
  const OldImage=global.Image;global.Image=class{set src(v){this._src=v;this.onload()}get src(){return this._src}}
  try{await find(tree,n=>n.type==='button'&&n.props.children==='Inspect research frame').props.onClick()}finally{global.Image=OldImage}
  tree=render();assert.equal(called,1)
  find(tree,n=>n.props?.['aria-label']==='Research label').props.onChange({target:{value:'COHERENT'}})
  tree=render();const rendered=JSON.stringify(tree)
  assert.ok(rendered.includes('COHERENT'));assert.ok(rendered.includes('LEFT_CROP'));assert.ok(rendered.includes('pass 2')||rendered.includes('pass '))
  assert.equal(JSON.stringify(product),before)
  // State consists only of research captures/rows and view selection. Linked raw/final rows share provenance.
  const rows=slots.find(s=>Array.isArray(s)&&s[0]?.stage)
  assert.equal(rows.length,2);assert.equal(rows[0].captureId,rows[1].captureId);assert.equal(rows[0].poseIndex,7);assert.equal(rows[1].passPose,2)
  assert.equal(rows[1].label,'UNLABELED')
})
test('inspector has no storage/API/product mutation capability',()=>{const src=fs.readFileSync(path.resolve(__dirname,'../src/app/pose-test/RawPoseResearch.tsx'),'utf8');assert.doesNotMatch(src,/localStorage|sessionStorage|fetch\(|setPersistent|setReferenceLedger|setAcquisition|setAutoResult|setSelectedFrameByPhase|buildCoaching/);assert.doesNotMatch(src,/from ['"].*(phase-detection|coaching-biomechanics)/)})
test('authoritative modules remain byte-equivalent to checkpoint',()=>{for(const file of ['src/lib/phase-detection.ts','src/lib/coaching-biomechanics.ts','src/app/pose-test/BiomechanicsPanel.tsx']){const base=execFileSync('git',['show',`c4deadf4d155c8c4c6501453ece41293df64c8cf:${file}`],{encoding:'utf8'});assert.equal(fs.readFileSync(path.resolve(__dirname,'..',file),'utf8').replace(/\r\n/g,'\n'),base.replace(/\r\n/g,'\n'))}})
test('all pre-existing page decision functions remain unchanged except observational trace capture',()=>{
 const file='src/app/pose-test/page.tsx',current=fs.readFileSync(path.resolve(__dirname,'..',file),'utf8'),base=execFileSync('git',['show',`c4deadf4d155c8c4c6501453ece41293df64c8cf:${file}`],{encoding:'utf8'})
 function functions(src){const root=ts.createSourceFile('page.tsx',src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),out={};function visit(n){if(ts.isVariableDeclaration(n)&&n.initializer&&ts.isArrowFunction(n.initializer)&&ts.isIdentifier(n.name))out[n.name.text]=n.initializer.getText(root);ts.forEachChild(n,visit)}visit(root);return out}
 const old=functions(base),now=functions(current)
 for(const name of ['getPoseLandmarker','runLandmarker','analyzeSelectedFrames','analyzeRemainingAfterAnchor','extractCandidateFrames','assignFrameToPhase','resetVideoAnalysis']){assert.ok(old[name],name);assert.equal(now[name],old[name],name)}
 // Remove only the additive trace properties/statements; the executable detector algorithm must match.
 const normalize=s=>s.replace(/, rawTrace: \{.*?landmarks: .*? \}\)\) \} \}/g,'}').replace(/^\s*const trace: PipelineTrace = .*\r?\n/gm,'').replace('candidates: deduped, trace','candidates: deduped').replace(/\s/g,'')
 assert.equal(normalize(now.detectMultiPass),normalize(old.detectMultiPass))
})
