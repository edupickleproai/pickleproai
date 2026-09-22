const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript')
function load(file,mocks={}){const name=path.resolve(__dirname,'..',file),m=new Module(name,module);m.filename=name;m.paths=module.paths;m.require=id=>id in mocks?mocks[id]:require(id);m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{fileName:name,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,name);return m.exports}
const h=load('src/lib/research-capture.ts'),poseHelpers=load('src/lib/pose-research.ts')

// Simulates seeked becoming observable BEFORE the new surface is presented.
// Drawing outside the callback would retain the previous frame in this browser model.
function environment(mode='normal'){
  const old=global.document, videos=[]
  class Video extends EventTarget{
    constructor(){super();videos.push(this);this.duration=20;this.videoWidth=1920;this.videoHeight=1080;this.readyState=0;this.time=0;this.surface=-1;this.count=0;this.handles=new Map();this.serial=0;this.stopped=true}
    get currentTime(){return this.time}
    set currentTime(t){this.time=t;this.seeking=true;this.dispatchEvent(new Event('seeking'));setImmediate(()=>{if(mode==='abortSeek')return;if(mode==='errorSeek'){this.dispatchEvent(new Event('error'));return}this.readyState=4;if(mode==='presentationFirst'){this.present(Math.floor(t*30+1e-7)/30);this.seeking=false;setImmediate(()=>this.dispatchEvent(new Event('seeked')))}else{this.seeking=false;this.dispatchEvent(new Event('seeked'));setImmediate(()=>this.present(mode==='stale'?0:Math.floor(t*30+1e-7)/30))}})}
    load(){if(!this.src)return;setImmediate(()=>{this.readyState=4;this.dispatchEvent(new Event('loadeddata'));this.present(0)})}
    present(pts){this.surface=pts;this.count++;const callbacks=[...this.handles.values()];this.handles.clear();this.inCallback=true;for(const f of callbacks)f(0,{mediaTime:pts,presentedFrames:this.count,expectedDisplayTime:this.count*33});this.inCallback=false}
    requestVideoFrameCallback(f){this.handles.set(++this.serial,f);return this.serial}
    cancelVideoFrameCallback(id){this.handles.delete(id)}
    play(){this.stopped=false;const tick=()=>{if(this.stopped)return;this.time=this.surface+1/30;this.present(this.time);setImmediate(tick)};setImmediate(tick);return Promise.resolve()}
    pause(){this.stopped=true}
    removeAttribute(){this.src=''}
  }
  global.document={createElement:tag=>{
    if(tag==='video'){const v=new Video();if(mode==='unsupported')v.requestVideoFrameCallback=undefined;return v}
    assert.equal(tag,'canvas');let value
    return{width:0,height:0,getContext:()=>({drawImage:v=>{assert.ok(v.inCallback,'must freeze within identified presentation');value=v.surface}}),toDataURL:()=>`data:image/jpeg;base64,${Buffer.from(String(value)).toString('base64')}`}
  }}
  return{videos,restore:()=>{global.document=old}}
}
async function capture(t,id='test',signal=new AbortController().signal){return h.captureResearchFrame('blob:test',t,id,signal)}

test('requested time and actual PTS are distinct and verified against observed cadence',async()=>{const e=environment();try{const f=await capture(1.337);assert.equal(f.timing.requestedTime,1.337);assert.ok(Math.abs(f.timing.actualTime-1.333333333333)<1e-9);assert.equal(f.timing.seekedCurrentTime,1.337);assert.ok(f.timing.differenceSeconds<0);assert.ok(Object.isFrozen(f));assert.equal(f.timing.integrity,'VERIFIED')}finally{e.restore()}})
test('repeated timestamp captures have identical frozen pixels/fingerprint but separate record IDs',async()=>{const e=environment();try{const a=await capture(2.5,'one'),b=await capture(2.5,'two');assert.equal(a.imageDataUrl,b.imageDataUrl);assert.equal(a.imageFingerprint,b.imageFingerprint);assert.notEqual(a.frameId,b.frameId)}finally{e.restore()}})
test('forward, reverse and zero-first sequences never reuse a stale image',async()=>{const e=environment();try{for(const seq of [[2.5,5],[5,2.5],[0,2.5,5]]){const frames=[];for(const t of seq)frames.push(await capture(t));for(let i=0;i<seq.length;i++){assert.equal(frames[i].timing.actualTime,seq[i]);assert.equal(Buffer.from(frames[i].imageDataUrl.split(',')[1],'base64').toString(),String(seq[i]))}}}finally{e.restore()}})
test('stale surface after a successful seek is rejected rather than mislabeled',async()=>{const e=environment('stale');try{await assert.rejects(capture(2.5),/UNVERIFIED/)}finally{e.restore()}})
test('failed seek creates no frame and releases video resources',async()=>{const e=environment('errorSeek');try{await assert.rejects(capture(2.5),/failed/);assert.equal(e.videos[0].src,'');assert.equal(e.videos[0].handles.size,0)}finally{e.restore()}})
test('aborted seek creates no frame and cancels callbacks',async()=>{const e=environment('abortSeek'),a=new AbortController();try{const p=capture(2.5,'aborted',a.signal);setImmediate(()=>a.abort());await assert.rejects(p,/cancelled/);assert.equal(e.videos[0].handles.size,0)}finally{e.restore()}})
test('missing presented-frame API abstains explicitly',async()=>{const e=environment('unsupported');try{await assert.rejects(capture(0),/cannot report presented/)}finally{e.restore()}})
test('skipped/irregular presentations and snapped timestamps cannot silently pass',()=>{const p=(t,n,current=2.5)=>({mediaTime:t,presentedFrames:n,currentTime:current});assert.throws(()=>h.verifyTiming(2.5,p(0,1),p(2.5,2),p(2.53333,3)),/UNVERIFIED/);assert.throws(()=>h.verifyTiming(2.5,p(2.5,1),p(2.53333,3),p(2.56667,4)),/UNVERIFIED/);assert.throws(()=>h.verifyTiming(2.5,p(2.6,1),p(2.63333,2),p(2.66667,3)),/UNVERIFIED/)})
test('frame checksum rejects a stale detector image',async()=>{const e=environment();try{const f=await capture(5);h.assertFrozenInput(f,f.imageDataUrl);assert.throws(()=>h.assertFrozenInput(f,'data:old'),/does not match/)}finally{e.restore()}})
test('transactions serialize rapid requests and old completion cannot release newer lock',()=>{const g=new h.ResearchTransactions(),a=g.begin();assert.equal(g.begin(),null);g.cancel();const b=g.begin();assert.notEqual(a,b);assert.equal(g.current(a),false);g.finish(a);assert.equal(g.begin(),null);g.finish(b);assert.notEqual(g.begin(),null)})

function harness(){
  const slots=[];let index=0,pendingDetect,detected=[];let fail=false
  const react={useEffect:()=>{},useState:init=>{const i=index++;if(!(i in slots))slots[i]=init;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v]},useRef:init=>{const i=index++;if(!(i in slots))slots[i]={current:init};return slots[i]}}
  const jsx=(type,props)=>({type,props})
  const Component=load('src/app/pose-test/RawPoseResearch.tsx',{'react':react,'react/jsx-runtime':{jsx,jsxs:jsx},'@/lib/pose-research':poseHelpers,'@/lib/research-capture':{...h,downloadResearchJson:()=>{},captureResearchFrame:async(url,time,id)=>{if(fail)throw Error('seek failed');const imageDataUrl=`data:${url}:${time}`;return Object.freeze({frameId:id,timestampSeconds:time,imageDataUrl,width:100,height:100,imageFingerprint:h.imageFingerprint(imageDataUrl),timing:{requestedTime:time,actualTime:time-.001,integrity:'VERIFIED'}})}}}).default
  const pts=Array.from({length:33},(_,i)=>({x:.2,y:i*.01,visibility:.9}))
  const trace=image=>({sourceImage:image.src,records:[{poseIndex:1,raw:{source:'FULL_FRAME',passPose:1,input:image.src,width:100,height:100,fullWidth:100,sx:0,landmarks:pts},final:{poseIndex:1,landmarks:pts,bbox:{left:0,top:0,width:1,height:1}},retained:true,overlaps:[]}]})
  const props={video:'a',videoUrl:'blob:a',fingerprint:'a',frames:[],busy:false,detect:async image=>{detected.push(image.src);if(pendingDetect)await pendingDetect;return trace(image)}}
  const find=(tree,predicate)=>{if(!tree||typeof tree!=='object')return;if(predicate(tree))return tree;for(const c of [tree.props?.children].flat(Infinity)){const n=find(c,predicate);if(n)return n}}
  const render=()=>{index=0;return Component(props)}
  const label=name=>find(render(),n=>n.props?.['aria-label']===name)
  const button=name=>find(render(),n=>n.type==='button'&&n.props.children===name)
  const oldImage=global.Image;global.Image=class{set src(v){this._src=v;queueMicrotask(()=>this.onload())}get src(){return this._src}}
  return{props,slots,render,label,button,detected,find,fail:()=>fail=true,setPending:p=>pendingDetect=p,rows:()=>slots.find(s=>Array.isArray(s)&&s[0]?.stage)||[],restore:()=>global.Image=oldImage}
}
test('component links displayed, detected and recorded frame and preserves labels on repeat',async()=>{const x=harness();try{x.label('Research timestamp').props.onChange({target:{value:'2.5'}});await x.button('Inspect research frame').props.onClick();const first=x.rows()[0];x.label('Research label').props.onChange({target:{value:'COHERENT'}});await x.button('Inspect research frame').props.onClick();const rows=x.rows();assert.equal(rows.length,4);assert.equal(rows[0].label,'COHERENT');assert.equal(rows[2].label,'UNLABELED');assert.notEqual(rows[0].id,rows[2].id);assert.equal(rows[0].frameFingerprint,rows[2].frameFingerprint);assert.equal(first.requestedTime,2.5);assert.equal(first.actualTime,2.499);const overlay=x.find(x.render(),n=>n.props?.name==='Research pose overlay');assert.equal(overlay.props.image,x.detected[1]);assert.equal(h.imageFingerprint(overlay.props.image),rows[2].frameFingerprint);assert.equal(rows[2].detectorInputFingerprint,rows[2].sourceImageFingerprint)}finally{x.restore()}})
test('component ignores stale detection across A to B to A video changes',async()=>{const x=harness();try{let resolve;const blocked=new Promise(r=>resolve=r);x.setPending(blocked);const old=x.button('Inspect research frame').props.onClick();await new Promise(setImmediate);assert.equal(x.detected.length,1);await x.button('Inspect research frame').props.onClick();assert.equal(x.detected.length,1);x.props.videoUrl='blob:b';x.props.fingerprint='b';x.render();x.props.videoUrl='blob:a';x.props.fingerprint='a';x.render();x.setPending(null);x.label('Research timestamp').props.onChange({target:{value:'5'}});await x.button('Inspect research frame').props.onClick();resolve();await old;assert.equal(x.rows().length,2);assert.equal(x.rows()[0].requestedTime,5)}finally{x.restore()}})
test('component failed capture creates no valid rows or detection',async()=>{const x=harness();try{x.fail();await x.button('Inspect research frame').props.onClick();assert.equal(x.rows().length,0);assert.equal(x.detected.length,0)}finally{x.restore()}})
test('JSON export matches current session and excludes image blobs, traces and raw arrays',async()=>{const x=harness();try{x.label('Research timestamp').props.onChange({target:{value:'1.337'}});await x.button('Inspect research frame').props.onClick();const row=x.rows()[0];const text=h.researchExport([{...row,imageDataUrl:'data:secret',landmarks:[1,2],trace:{raw:[3]},rawLandmarks:[4]}]);const exported=JSON.parse(text);assert.equal(exported.authority,'NONE');assert.equal(exported.rows[0].requestedTime,1.337);assert.equal(exported.rows[0].actualTime,1.336);assert.equal(exported.rows[0].frameFingerprint,row.frameFingerprint);assert.doesNotMatch(text,/data:secret|imageDataUrl|landmarks|rawLandmarks|"trace"/);x.button('Export research JSON (no images)').props.onClick();assert.equal(JSON.parse(x.label('Research JSON export').props.value).rows.length,x.rows().length)}finally{x.restore()}})
test('download anchors are attached and URL remains valid through click',()=>{const oldDoc=global.document,oldTimer=global.setTimeout,oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;let attached=false,clicked=false,removed=false,revoked=false,cleanup;try{URL.createObjectURL=()=> 'blob:export';URL.revokeObjectURL=()=>revoked=true;global.setTimeout=(f,ms)=>{assert.ok(ms>0);cleanup=f};global.document={body:{appendChild:()=>attached=true},createElement:()=>({click:()=>{assert.ok(attached);assert.equal(revoked,false);clicked=true},remove:()=>removed=true})};h.downloadResearchJson('{"authority":"NONE","rows":[]}');assert.ok(clicked&&removed);assert.equal(revoked,false);cleanup();assert.ok(revoked)}finally{global.document=oldDoc;global.setTimeout=oldTimer;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke}})
test('capture helper has no product authority or product imports',()=>{const src=fs.readFileSync(path.resolve(__dirname,'../src/lib/research-capture.ts'),'utf8');assert.doesNotMatch(src,/from ['"]|fetch\(|localStorage|sessionStorage|TARGET_A|coachingEligible/);assert.equal(JSON.parse(h.researchExport([])).authority,'NONE')})

test('presentation preceding seeked is frozen then waits for seek completion',async()=>{const e=environment('presentationFirst');try{const f=await capture(5);assert.equal(f.timing.actualTime,5);assert.equal(f.timing.seekedCurrentTime,5);assert.ok(f.timing.seekedElapsedMs>=f.timing.presentation.elapsedMs)}finally{e.restore()}})
