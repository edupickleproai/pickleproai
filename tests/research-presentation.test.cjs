const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript')
const file=path.resolve(__dirname,'../src/lib/research-capture.ts'),m=new Module(file,module)
m.filename=file;m.paths=module.paths
m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
const {verifyTiming}=m.exports
const traces=require('./fixtures/research-presentation-traces.cjs')
const witnesses=sequence=>sequence.filter(e=>e.witness==='sought presentation'||e.stage==='VERIFYING')
const frame=(t,n,current)=>({mediaTime:t,presentedFrames:n,currentTime:current})

test('non-exact requests use the containing source interval, not an exact timestamp requirement',()=>{
  for(const f of traces){const [candidate,next,following]=witnesses(f.normalSpeed)
    assert.ok(candidate.mediaTime<=f.requestedTime&&f.requestedTime<next.mediaTime)
    assert.ok(f.sourcePts.includes(candidate.mediaTime));assert.ok(f.sourcePts.includes(next.mediaTime))
    assert.ok(verifyTiming(f.requestedTime,candidate,next,following)>0)
  }
  assert.notEqual(traces[0].requestedTime,witnesses(traces[0].normalSpeed)[0].mediaTime)
})
test('nearest following frame is not accepted when the request still belongs to its predecessor',()=>{
  assert.throws(()=>verifyTiming(11.533,frame(11.533333,4,11.533),frame(11.566667,5,11.533),frame(11.6,6,11.533)),/UNVERIFIED/)
  assert.ok(verifyTiming(11.533333,frame(11.533333,4,11.533333),frame(11.566667,5,11.533333),frame(11.6,6,11.533333))>0)
})
test('recorded quarter-speed fixture reproduces all five prior presentation skips',()=>{
  for(const f of traces){const [candidate,next,following]=witnesses(f.quarterSpeed)
    assert.deepEqual([candidate.presentedFrames,next.presentedFrames,following.presentedFrames],[4,5,6])
    assert.ok(Math.abs((following.mediaTime-next.mediaTime)-(next.mediaTime-candidate.mediaTime))>.03)
    assert.throws(()=>verifyTiming(f.requestedTime,candidate,next,following),/UNVERIFIED/)
  }
})
test('normal-speed fixture supplies actual missing source witnesses to the unchanged verifier',()=>{
  for(const f of traces){const [candidate,next,following]=witnesses(f.normalSpeed)
    const index=f.sourcePts.indexOf(candidate.mediaTime)
    assert.deepEqual([candidate.mediaTime,next.mediaTime,following.mediaTime],f.sourcePts.slice(index,index+3))
    assert.ok(verifyTiming(f.requestedTime,candidate,next,following)>0)
  }
})
test('a truly skipped presentation cannot be rescued by the new playback policy',()=>{
  for(const f of traces){const [candidate,next,following]=witnesses(f.normalSpeed)
    assert.throws(()=>verifyTiming(f.requestedTime,candidate,{...next,presentedFrames:next.presentedFrames+1},following),/UNVERIFIED/)
  }
})
test('nonuniform local cadence safely abstains when neighboring source evidence is unavailable',()=>{
  assert.throws(()=>verifyTiming(2.61,frame(2.6,1,2.61),frame(2.63,2,2.61),frame(2.69,3,2.61)),/UNVERIFIED/)
  // A variable-rate source may still have a uniform local interval; no global fps is assumed.
  assert.ok(verifyTiming(2.61,frame(2.6,1,2.61),frame(2.63,2,2.61),frame(2.66,3,2.61))>0)
})
test('duplicate and reversed witness timestamps remain invalid',()=>{
  assert.throws(()=>verifyTiming(2.6,frame(2.6,1,2.6),frame(2.6,2,2.6),frame(2.6,3,2.6)),/UNVERIFIED/)
  assert.throws(()=>verifyTiming(2.6,frame(2.6,1,2.6),frame(2.63,2,2.6),frame(2.6,3,2.6)),/UNVERIFIED/)
})
test('stale pre-seek PTS cannot be made valid by assigning the requested currentTime',()=>{
  for(const f of traces){const [candidate,next,following]=witnesses(f.normalSpeed)
    assert.throws(()=>verifyTiming(f.requestedTime,{...candidate,mediaTime:0},next,following),/UNVERIFIED/)
  }
})
test('callback sequence is complete and preserves wall order independently of expected display time',()=>{
  for(const f of traces)for(const events of [f.quarterSpeed,f.normalSpeed]){
    assert.deepEqual(events.map(e=>e.callbackSequence),[1,2,3,4,5,6])
    for(let i=1;i<events.length;i++)assert.ok(events[i].wallClockMs>=events[i-1].wallClockMs)
    for(const e of events){assert.ok(Number.isFinite(e.processingDuration));assert.ok(Number.isFinite(e.expectedDisplayTime));assert.ok(Number.isFinite(e.callbackNow))}
  }
})
test('future compositor display time does not turn a skipped witness into cadence evidence',()=>{
  const f=traces[0],p=witnesses(f.quarterSpeed)
  assert.ok(p[2].expectedDisplayTime>p[2].callbackNow+100)
  assert.throws(()=>verifyTiming(f.requestedTime,...p),/UNVERIFIED/)
})
