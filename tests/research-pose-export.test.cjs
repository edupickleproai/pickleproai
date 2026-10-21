const {test}=require('node:test')
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),crypto=require('node:crypto')
function load(file,mocks={}){const name=path.resolve(file),m=new Module(name,module);m.filename=name;m.paths=module.paths;m.require=id=>id in mocks?mocks[id]:require(id);m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{fileName:name,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,name);return m.exports}
const capture=load('src/lib/research-capture.ts'),frame=load('src/lib/research-frame-export.ts',{'./research-capture':capture}),h=load('src/lib/research-pose-export.ts',{'./research-capture':capture,'./research-frame-export':frame})
function fixture(){
 const imageDataUrl='data:image/jpeg;base64,/9j/2Q==',p=(mediaTime,presentedFrames)=>({mediaTime,presentedFrames,currentTime:1,expectedDisplayTime:1,elapsedMs:1})
 const input={videoId:'SYNTHETIC',sourceId:'synthetic-source',frame:{frameId:'synthetic-transaction',timestampSeconds:1,imageDataUrl,imageFingerprint:capture.imageFingerprint(imageDataUrl),width:48,height:32,timing:{integrity:'VERIFIED',requestedTime:1,actualTime:1,presentation:p(1,1),followingPresentations:[p(1.04,2),p(1.08,3)],attempts:[{outcome:'VERIFIED',sourceId:'synthetic-source',transactionId:'synthetic-transaction'}]}}}
 const records=['FULL_FRAME','LEFT_CROP','RIGHT_CROP','RIGHT_CROP'].map((source,i)=>{const landmarks=Array.from({length:33},(_,j)=>({x:0.12345678901234566+j/101,y:j/37,z:-(j+1)/59,visibility:.9876543210123456,presence:.8765432101234567}));return{poseIndex:i+1,raw:{source,passPose:i===3?2:1,input:imageDataUrl,width:i?24:48,height:32,sx:i>1?24:0,fullWidth:48,landmarks},final:{poseIndex:i+1,landmarks:landmarks.map(p=>({...p})),worldLandmarks:null,bbox:{left:0,top:0,width:1,height:1}},retained:i<2,suppressedBy:i<2?null:2,overlaps:[{poseIndex:2,iou:.654321}]}})
 return {input,trace:{sourceImage:imageDataUrl,records}}
}
async function env(fn){const old=process.env.NODE_ENV,bitmap=global.createImageBitmap;process.env.NODE_ENV='development';global.createImageBitmap=async()=>({width:48,height:32,close(){}});try{await fn()}finally{process.env.NODE_ENV=old;global.createImageBitmap=bitmap}}
test('all four original arrays, ordering and numeric precision survive serialization and reload',()=>env(async()=>{const f=fixture(),before=structuredClone(f),out=await h.prepareCompletePoseEvidence(f.input,f.trace),v=JSON.parse(out.json);assert.equal(v.candidateCount,4);v.hypotheses.forEach((x,i)=>{assert.deepEqual(x.rawLandmarks,f.trace.records[i].raw.landmarks);assert.equal(x.landmarkCount,33);assert.equal(x.order,i)});assert.deepEqual(f,before);assert.equal(out.sha256,crypto.createHash('sha256').update(out.json).digest('hex'));assert.equal(await out.blob.text(),out.json);assert.equal(h.validatePoseEvidence(v),v)}))
test('source/pass, crop mapping, retained and suppression provenance preserved',()=>env(async()=>{const f=fixture(),v=JSON.parse((await h.prepareCompletePoseEvidence(f.input,f.trace)).json);v.hypotheses.forEach((x,i)=>{const r=f.trace.records[i];assert.equal(x.source,r.raw.source);assert.equal(x.passPose,r.raw.passPose);assert.equal(x.frameLocalIndex,r.poseIndex);assert.deepEqual(x.mappedCandidate,r.final);assert.deepEqual(x.deduplication,{retained:r.retained,suppressedBy:r.suppressedBy,overlaps:r.overlaps});assert.equal(x.cropBounds.x,r.raw.sx);assert.equal(x.mapping.appliedByExport,false)});assert.equal(v.images.png,null);assert.equal(v.capture.requestedTimestamp,1);assert.equal(v.images.jpeg.originalBytes,true)}))
test('unknown fields, null, undefined, negative zero and nonfinite values remain distinguishable',()=>env(async()=>{const f=fixture(),p=f.trace.records[0].raw.landmarks[0];delete p.z;p.visibility=null;p.presence=undefined;p.extra=-0;p.unknown=NaN;const v=JSON.parse((await h.prepareCompletePoseEvidence(f.input,f.trace)).json);const q=v.hypotheses[0].rawLandmarks[0];assert.equal('z' in q,false);assert.equal(q.visibility,null);assert.equal(q.presence,null);assert.deepEqual(v.specialValues.map(x=>x.kind),['undefined','-0','NaN']);assert.ok(v.specialValues.every(x=>x.path.startsWith('/hypotheses/0/rawLandmarks/0/')))}))
test('missing arrays and detector/frame mismatch fail closed',()=>env(async()=>{for(const mutate of [f=>delete f.trace.records[0].raw.landmarks,f=>f.trace.sourceImage='different',f=>f.trace.records[0].raw.sx=100]){const f=fixture();mutate(f);await assert.rejects(h.prepareCompletePoseEvidence(f.input,f.trace))}}))
test('unverified timing and inconsistent candidate identity rejected',()=>env(async()=>{for(const mutate of [f=>f.input.frame.timing.integrity='UNVERIFIED',f=>f.trace.records[1].poseIndex=99,f=>f.trace.records[1].raw.source='UNKNOWN']){const f=fixture();mutate(f);await assert.rejects(h.prepareCompletePoseEvidence(f.input,f.trace))}}))
test('schema rejects version, count, correspondence and array corruption',()=>env(async()=>{const f=fixture(),v=JSON.parse((await h.prepareCompletePoseEvidence(f.input,f.trace)).json);for(const mutate of [x=>x.schemaVersion=2,x=>x.candidateCount=3,x=>x.hypotheses[0].captureTransactionId='other',x=>x.hypotheses[0].rawLandmarks.pop(),x=>x.hypotheses[1].candidateId=x.hypotheses[0].candidateId]){const bad=structuredClone(v);mutate(bad);assert.throws(()=>h.validatePoseEvidence(bad))}}))
test('production helper fails before image decoding',()=>env(async()=>{process.env.NODE_ENV='production';global.createImageBitmap=()=>{throw Error('must not decode')};const f=fixture();await assert.rejects(h.prepareCompletePoseEvidence(f.input,f.trace),/development-only/)}))
test('real UI uses only passed evidence, trusted download, and has no production control',()=>env(async()=>{
 const slots=[];let index=0,prepared=0,downloaded=0
 const react={useState:init=>{const i=index++;if(!(i in slots))slots[i]=init;return[slots[i],v=>slots[i]=v]}}
 const jsx=(type,props)=>({type,props}),f=fixture()
 const UI=load('src/app/pose-test/VerifiedFrameExport.tsx',{'react':react,'react/jsx-runtime':{jsx,jsxs:jsx},'@/lib/research-frame-export':{...frame,downloadVerifiedFrameArtifact:(b,n,t)=>{assert.equal(t,true);assert.match(n,/research-pose-evidence/);downloaded++}},'@/lib/research-pose-export':{prepareCompletePoseEvidence:async(input,trace)=>{assert.equal(trace,f.trace);prepared++;return h.prepareCompletePoseEvidence(input,trace)}}}).default
 function render(){index=0;return UI(f)}function find(node,text){if(!node||typeof node!=='object')return; if(node.type==='button'&&node.props.children===text)return node;for(const c of [node.props?.children].flat(Infinity)){const found=find(c,text);if(found)return found}}
 await find(render(),'Export Complete Pose Evidence').props.onClick();assert.equal(prepared,1);find(render(),'Download complete pose evidence JSON').props.onClick({nativeEvent:{isTrusted:true}});assert.equal(downloaded,1);assert.equal(prepared,1);process.env.NODE_ENV='production';assert.equal(render(),null)
}))
test('export integration does not add inference or product dependencies',()=>{const helper=fs.readFileSync('src/lib/research-pose-export.ts','utf8');assert.doesNotMatch(helper,/fetch\(|detect\(|MediaPipe|tracking|coaching|localStorage/);const ui=fs.readFileSync('src/app/pose-test/RawPoseResearch.tsx','utf8');assert.match(ui,/trace=\{exportCapture.trace\}/);assert.match(ui,/process.env.NODE_ENV==='development'&&exportCapture&&<VerifiedFrameExport/);})

test('verified zero-candidate export preserves original bytes and capture identity without fabricated evidence',()=>env(async()=>{
 const f=fixture();f.trace.records=[];const before=structuredClone(f)
 const image=await frame.prepareVerifiedFrameExport(f.input),out=await h.prepareCompletePoseEvidence(f.input,f.trace),v=JSON.parse(out.json)
 assert.deepEqual(v.hypotheses,[]);assert.equal(v.candidateCount,0);assert.deepEqual(v.specialValues,[])
 assert.deepEqual(v.capture,JSON.parse(await image.provenance.text()));assert.equal(v.capture.captureTransactionId,f.input.frame.frameId)
 assert.equal(v.capture.requestedTimestamp,1);assert.equal(v.capture.presentedTimestamp,1);assert.equal(v.capture.captureFingerprint,f.input.frame.imageFingerprint)
 assert.deepEqual([v.capture.width,v.capture.height],[48,32]);assert.deepEqual(Buffer.from(await image.jpeg.arrayBuffer()),Buffer.from('/9j/2Q==','base64'))
 assert.equal(h.validatePoseEvidence(JSON.parse(await out.blob.text())).candidateCount,0);assert.equal(out.sha256,crypto.createHash('sha256').update(out.json).digest('hex'));assert.deepEqual(f,before)
}))

test('zero-candidate export retains invalid-capture and production rejection',()=>env(async()=>{
 for(const mutate of [f=>f.input.frame.timing.integrity='UNVERIFIED',f=>f.input.frame.imageFingerprint='wrong',f=>f.input.frame.timing.attempts[0].transactionId='wrong']){const f=fixture();f.trace.records=[];mutate(f);await assert.rejects(frame.prepareVerifiedFrameExport(f.input));await assert.rejects(h.prepareCompletePoseEvidence(f.input,f.trace))}
 const f=fixture();f.trace.records=[];process.env.NODE_ENV='production';await assert.rejects(h.prepareCompletePoseEvidence(f.input,f.trace),/development-only/)
}))

test('research UI exports zero-candidate captures independently of rows and retains nonempty row selection',()=>env(async()=>{
 const f=fixture(),empty={id:'empty',video:'SYNTHETIC',fingerprint:'synthetic-source',frame:f.input.frame,trace:{sourceImage:f.trace.sourceImage,records:[]}},full={...empty,id:'full',trace:f.trace}
 let slots=[],index=0;const react={useState:init=>{const i=index++;if(!(i in slots))slots[i]=init;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v]},useRef:v=>({current:v}),useEffect(){}}
 const jsx=(type,props)=>({type,props}),Export=()=>null
 const UI=load('src/app/pose-test/RawPoseResearch.tsx',{'react':react,'react/jsx-runtime':{jsx,jsxs:jsx},'./ResearchVideoSource':{default:()=>null},'./RawPoseReview':{default:()=>null},'./VerifiedFrameExport':{__esModule:true,default:Export},'@/lib/research-review':{},'@/lib/pose-coherence':{},'@/lib/research-capture':capture,'@/lib/pose-research':{}}).default
 function find(n,p){if(!n||typeof n!=='object')return;if(p(n))return n;for(const c of [n.props?.children].flat(Infinity)){const x=find(c,p);if(x)return x}}
 const props={video:'SYNTHETIC',videoUrl:null,fingerprint:null,frames:[],busy:false,detect(){throw Error('must not infer')}}
 function render(){index=0;return UI(props)}
 render();slots[3]=[empty,full];slots[6]='empty';let tree=render();assert.equal(find(tree,n=>n.type===Export).props.trace,empty.trace)
 const select=find(tree,n=>n.props?.['aria-label']==='Captured frame for export');select.props.onChange({target:{value:'full'}});assert.equal(find(render(),n=>n.type===Export).props.trace,full.trace)
 slots[4]=[{id:'row',captureId:'full',poseIndex:1,stage:'raw',timestamp:1,source:'FULL_FRAME',passPose:1,requestedTime:1,actualTime:1}];slots[5]='row';slots[6]='empty';assert.equal(find(render(),n=>n.type===Export).props.trace,full.trace)
 slots[4]=[];slots[5]=null;process.env.NODE_ENV='production';assert.equal(find(render(),n=>n.type===Export),undefined)
}))


