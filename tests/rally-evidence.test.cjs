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


const os=require('os')
const {execFileSync}=require('child_process')
const rally=load('src/lib/rally-evidence.ts')
const frames=load('src/lib/rally-frames.ts',{'./rally-evidence':rally})
const bio=load('src/lib/coaching-biomechanics.ts')
const selection={confirmed:true,kind:'user-confirmed',description:'Blue shirt on near court',representativeTime:0,point:{x:.2,y:.6},coordinateBasis:'normalized-displayed-frame',trackingEstablished:false}
test('duration and bounded ordered early-middle-late targets',()=>{
 for(const d of [1,10,30,60]){const t=rally.sampleTimes(d);assert.ok(t.length>=3&&t.length<=8);assert.equal(t[0],0);assert.ok(t.at(-1)>.85*d);assert.ok(t.some(x=>x>.3*d&&x<.7*d));assert.ok(t.every((x,i)=>!i||x>t[i-1]))}
 for(const d of [0,-1,NaN,Infinity,60.001,90])assert.throws(()=>rally.sampleTimes(d))
})
test('confirmation preserves intent, timestamp and coordinates without claiming tracking',()=>{
 assert.deepEqual(rally.playerConfirmation(selection),selection)
 for(const bad of [{...selection,confirmed:false},{...selection,description:''},{...selection,representativeTime:2},{...selection,point:{x:2,y:.5}},{...selection,trackingEstablished:true}])assert.throws(()=>rally.playerConfirmation(bad))
 assert.equal(rally.playerConfirmation({...selection,point:null}).point,null)
})
test('real synthetic 10/30/60s extraction and upload pipeline use actual timestamps, full coverage, and bounded payloads',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rally403-'))
 const prior=process.env.FFMPEG_PATH,mode=process.env.NODE_ENV
 process.env.FFMPEG_PATH=require('ffmpeg-static')
 process.env.NODE_ENV='production'
 let uncertain=false;const requests=[]
 class FakeAI{chat={completions:{create:async r=>{requests.push(r);return {choices:[{message:{content:r.max_tokens===300?JSON.stringify({description:'Blue shirt',identityUncertain:uncertain}):'Technical Diagnosis: Visible posture at 0s.\nScore Breakdown:\nFootwork: 7\nTiming: N/A'}}]}}}}}
 const route=load('src/app/api/video-analysis/route.ts',{'@/lib/rally-evidence':rally,'@/lib/rally-frames':frames,'@/lib/coaching-biomechanics':bio,openai:{__esModule:true,OpenAI:FakeAI}})
 try{
  for(const duration of [10,30,60,61]){
   const file=path.join(dir,duration+'.mp4')
   execFileSync(process.env.FFMPEG_PATH,['-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=10','-t',String(duration),'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',file],{windowsHide:true})
   const makeForm=()=>{const f=new FormData();f.set('video',new File([fs.readFileSync(file)],'synthetic.mp4',{type:'video/mp4'}));f.set('notes','Footwork');f.set('playerConfirmation',JSON.stringify(selection));return f}
   requests.length=0
   const response=await route.POST(new Request('http://localhost/api/video-analysis',{method:'POST',body:makeForm()}))
   const out=await response.json()
   if(duration>60){assert.equal(response.status,422);assert.equal(requests.length,0);continue}
   assert.equal(response.status,200,JSON.stringify(out))
   const c=out.analysis.coverage
   assert.equal(c.duration,duration);assert.equal(c.count,rally.sampleTimes(duration).length)
   assert.ok(c.timestamps.at(-1)>.85*duration);assert.ok(c.timestamps.every((t,i)=>!i||t>c.timestamps[i-1]))
   assert.equal(out.analysis.frames.length,c.count)
   assert.deepEqual(out.analysis.confirmedPlayer,selection)
   assert.equal(requests.length,2)
   for(const request of requests){const content=request.messages[1].content;const images=content.filter(c=>c.type==='image_url');assert.equal(images.length,c.count);assert.ok(images.every(x=>x.image_url.detail==='low'));const serialized=JSON.stringify(content);assert.match(serialized,/user-confirmed/);assert.ok(serialized.includes('Total video duration: '+duration));assert.match(serialized,/not continuous video tracking/);for(const t of c.timestamps)assert.ok(serialized.includes(t.toFixed(6)))}
   assert.equal(out.analysis.scoreBreakdown.footwork,7);assert.equal(out.analysis.scoreBreakdown.timing,null)
   if(duration===10){
    uncertain=true;requests.length=0
    const unknown=await route.POST(new Request('http://localhost/api/video-analysis',{method:'POST',body:makeForm()}))
    const result=(await unknown.json()).analysis
    assert.equal(requests.length,1);assert.equal(result.score,null);assert.equal(result.identityUncertain,true);assert.match(result.diagnosis,/No player-specific coaching/)
    uncertain=false
    const unconfirmed=makeForm();unconfirmed.delete('playerConfirmation');requests.length=0
    assert.equal((await route.POST(new Request('http://localhost/api/video-analysis',{method:'POST',body:unconfirmed}))).status,400)
    assert.equal(requests.length,0)
   }
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});if(prior===undefined)delete process.env.FFMPEG_PATH;else process.env.FFMPEG_PATH=prior;if(mode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=mode}
})

test('preview requires description and explicit confirmation; edits invalidate intent',()=>{
 const React=require('react');let index=0;const slots=[];const changes=[]
 const react={...React,useEffect:()=>{},useState:initial=>{const i=index++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>slots[i]=v]}}
 const Component=load('src/app/video-review/PlayerConfirmation.tsx',{'react':react,'@/lib/rally-evidence':rally}).default
 const render=()=>{index=0;return Component({file:{},onChange:v=>changes.push(v)})}
 const find=(node,type)=>{if(!node||typeof node!=='object')return;if(node.type===type)return node;for(const child of [node.props?.children].flat(Infinity)){const found=find(child,type);if(found)return found}}
 render();slots[0]='blob:test'
 let tree=render();assert.equal(find(tree,'input').props.disabled,true)
 find(tree,'video').props.onLoadedMetadata({currentTarget:{duration:30}})
 find(tree,'video').props.onLoadedData({currentTarget:{duration:30}})
 find(render(),'textarea').props.onChange({target:{value:'Blue shirt'}})
 tree=render();assert.equal(find(tree,'input').props.disabled,false)
 find(tree,'input').props.onChange({target:{checked:true}})
 assert.deepEqual(rally.playerConfirmation(changes.at(-1)),{...selection,description:'Blue shirt',point:null})
 find(render(),'textarea').props.onChange({target:{value:'Other player'}})
 assert.equal(changes.at(-1),null)
 find(render(),'video').props.onClick({currentTarget:{getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})},clientX:20,clientY:60})
 find(render(),'input').props.onChange({target:{checked:true}})
 assert.deepEqual(changes.at(-1).point,{x:.2,y:.6})
})
