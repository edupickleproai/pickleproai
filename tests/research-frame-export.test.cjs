const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript')
function load(file,mocks={}){const name=path.resolve(__dirname,'..',file),m=new Module(name,module);m.filename=name;m.paths=module.paths;m.require=id=>id in mocks?mocks[id]:require(id);m._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,name);return m.exports}
const capture=load('src/lib/research-capture.ts')
const h=load('src/lib/research-frame-export.ts',{'./research-capture':capture})
function fixture(){
 const imageDataUrl='data:image/jpeg;base64,/9j/2Q=='
 const p=(mediaTime,presentedFrames)=>({mediaTime,presentedFrames,currentTime:1,expectedDisplayTime:1,elapsedMs:1})
 return{videoId:'SYNTHETIC',sourceId:'fixture-source',frame:{frameId:'fixture-transaction',timestampSeconds:1,imageDataUrl,imageFingerprint:capture.imageFingerprint(imageDataUrl),width:8,height:6,timing:{integrity:'VERIFIED',requestedTime:1,actualTime:1,presentation:p(1,1),followingPresentations:[p(1.04,2),p(1.08,3)],attempts:[{outcome:'VERIFIED',sourceId:'fixture-source',transactionId:'fixture-transaction'}]}}}
}
async function env(fn){const old=process.env.NODE_ENV,bitmap=global.createImageBitmap;process.env.NODE_ENV='development';global.createImageBitmap=async()=>({width:8,height:6,close(){}});try{await fn()}finally{process.env.NODE_ENV=old;global.createImageBitmap=bitmap}}
test('original encoded bytes, hashes, dimensions and provenance preserved without input mutation',()=>env(async()=>{
 const input=fixture(),before=JSON.stringify(input),out=await h.prepareVerifiedFrameExport(input)
 assert.deepEqual(Buffer.from(await out.jpeg.arrayBuffer()),Buffer.from('/9j/2Q==','base64'))
 const p=JSON.parse(await out.provenance.text());assert.equal(p.image.sha256,require('crypto').createHash('sha256').update(Buffer.from('/9j/2Q==','base64')).digest('hex'))
 assert.equal(p.captureTransactionId,input.frame.frameId);assert.equal(p.sourceId,input.sourceId);assert.equal(p.videoId,'SYNTHETIC');assert.equal(p.width,8);assert.equal(p.height,6);assert.deepEqual(p.timing,input.frame.timing);assert.equal(JSON.stringify(input),before)
}))
test('production export preparation and download fail closed',()=>env(async()=>{process.env.NODE_ENV='production';await assert.rejects(h.prepareVerifiedFrameExport(fixture()),/development-only/);assert.throws(()=>h.downloadVerifiedFrameArtifact(new Blob(),'x',true),/development-only/)}))
test('unverified capture, altered witness, missing source, transaction mismatch rejected',()=>env(async()=>{
 for(const mutate of [x=>x.frame.timing.integrity='UNVERIFIED',x=>x.frame.timing.followingPresentations[0].presentedFrames=9,x=>x.sourceId='',x=>x.frame.timing.attempts[0].transactionId='other']){
  const x=fixture();mutate(x);await assert.rejects(h.prepareVerifiedFrameExport(x))
 }
}))
test('changed image and missing original JPEG fail explicitly',()=>env(async()=>{
 const x=fixture();x.frame.imageFingerprint='changed';await assert.rejects(h.prepareVerifiedFrameExport(x),/fingerprint/)
 x.frame.imageDataUrl='data:image/png;base64,AAAA';x.frame.imageFingerprint=capture.imageFingerprint(x.frame.imageDataUrl);await assert.rejects(h.prepareVerifiedFrameExport(x),/JPEG bytes/)
}))
test('decoded dimension mismatch rejected and bitmap released',()=>env(async()=>{
 let closed=false;global.createImageBitmap=async()=>({width:9,height:6,close(){closed=true}})
 await assert.rejects(h.prepareVerifiedFrameExport(fixture()),/dimensions/);assert.equal(closed,true)
}))
test('download requires trusted active click; URL remains valid through click',()=>env(async()=>{
 const oldNav=Object.getOwnPropertyDescriptor(global,'navigator'),oldDoc=global.document,oldTimer=global.setTimeout,oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL
 let clicked=false,revoked=false,cleanup
 Object.defineProperty(global,'navigator',{configurable:true,value:{userActivation:{isActive:false}}})
 global.document={body:{appendChild(){}},createElement(){return{click(){assert.equal(revoked,false);clicked=true},remove(){}}}}
 URL.createObjectURL=()=> 'blob:fixture';URL.revokeObjectURL=()=>{revoked=true};global.setTimeout=(f,ms)=>{assert.equal(ms,60000);cleanup=f}
 try{
  assert.throws(()=>h.downloadVerifiedFrameArtifact(new Blob(),'x',true),/explicit/)
  navigator.userActivation.isActive=true;assert.throws(()=>h.downloadVerifiedFrameArtifact(new Blob(),'x',false),/explicit/)
  assert.equal(clicked,false);h.downloadVerifiedFrameArtifact(new Blob(),'x',true);assert.equal(clicked,true);assert.equal(revoked,false);cleanup();assert.equal(revoked,true)
 }finally{if(oldNav)Object.defineProperty(global,'navigator',oldNav);else delete global.navigator;global.document=oldDoc;global.setTimeout=oldTimer;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke}
}))
test('UI control is development-gated and export module has no product dependencies',()=>{
 const ui=fs.readFileSync('src/app/pose-test/RawPoseResearch.tsx','utf8'),helper=fs.readFileSync('src/lib/research-frame-export.ts','utf8')
 assert.match(ui,/process\.env\.NODE_ENV==='development'&&<VerifiedFrameExport/)
 assert.doesNotMatch(helper,/drawImage|fetch\(|localStorage|phase-detection|coaching|detect\(/)
 assert.match(fs.readFileSync('src/app/pose-test/VerifiedFrameExport.tsx','utf8'),/nativeEvent\.isTrusted/)
})
