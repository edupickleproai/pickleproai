'use client'

import { useRef, useState } from 'react'
import { MODEL_SHA256, PERSON_CONFIG, personBoxes, posePersonRelationships, normalizeSession, validateSession, type EvidenceSession, type PersonBox } from '@/lib/research-person-evidence'

const sha256=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('')
type Result = {frameKey:string; width:number; height:number; inferenceMs:number[]; detections:PersonBox[]; relationships:Array<{candidateId:string;diagnostics:ReturnType<typeof posePersonRelationships>}>}
export default function PersonEvidence() {
  const [session,setSession]=useState<EvidenceSession|null>(null),[model,setModel]=useState<File|null>(null)
  const [status,setStatus]=useState('Load a frozen development annotation session and the local model.'),[running,setRunning]=useState(false)
  const [results,setResults]=useState<Result[]>([]),[exportText,setExportText]=useState(''),[selected,setSelected]=useState(0),[pose,setPose]=useState('')
  const lock=useRef(false)
  if(process.env.NODE_ENV!=='development') return null
  const load=async(file?:File)=>{
    if(!file||lock.current)return
    try {const next=normalizeSession(JSON.parse(await file.text()));validateSession(next);setSession(next);setResults([]);setExportText('');setSelected(0);setPose('');setStatus(`Frozen session ready: ${next.frames.length} development frames.`)}
    catch(e){setSession(null);setStatus(String(e))}
  }
  const run=async()=>{
    if(!session||!model||lock.current)return
    lock.current=true;setRunning(true);setResults([]);setExportText('')
    let detector:import('@mediapipe/tasks-vision').ObjectDetector|undefined
    try {
      validateSession(session)
      const bytes=await model.arrayBuffer(),hash=await sha256(bytes)
      if(hash!==MODEL_SHA256)throw Error('Model hash does not match the frozen EfficientDet-Lite0 int8 v1 asset.')
      const started=performance.now()
      const {ObjectDetector,FilesetResolver}=await import('@mediapipe/tasks-vision')
      const fileset=await FilesetResolver.forVisionTasks('/pose-test/person-evidence/wasm')
      const {delegate,...options}=PERSON_CONFIG
      detector=await ObjectDetector.createFromOptions(fileset,{...options,baseOptions:{modelAssetBuffer:new Uint8Array(bytes),delegate}})
      const initializationMs=performance.now()-started, output:Result[]=[]
      const publish=()=>setExportText(JSON.stringify({sprint:'3.0.15a',authority:'NONE',configuration:PERSON_CONFIG,modelSha256:hash,modelBytes:bytes.byteLength,package:'@mediapipe/tasks-vision@1.0.1',initializationMs,browser:navigator.userAgent,annotationsFrozenAt:session.annotationsFrozenAt,annotationsSha256:session.annotationsSha256,completed:output.length,total:session.frames.length,results:output},null,2))
      for(const frame of session.frames){
        setStatus(`Processing ${frame.frameKey} (${frame.video})`)
        const raw=await (await fetch(frame.imageDataUrl)).arrayBuffer()
        if(await sha256(raw)!==frame.pngSha256)throw Error(`Image hash mismatch: ${frame.frameKey}`)
        const image=new Image();image.src=frame.imageDataUrl;await image.decode()
        if(image.naturalWidth!==frame.width||image.naturalHeight!==frame.height)throw Error('Image dimensions mismatch.')
        const inferenceMs:number[]=[];let detections:PersonBox[]=[]
        for(let repeat=0;repeat<3;repeat++){
          const start=performance.now(),result=detector.detect(image);inferenceMs.push(performance.now()-start)
          const boxes=personBoxes(result.detections,frame.width,frame.height)
          if(repeat===0)detections=boxes
          else if(JSON.stringify(boxes)!==JSON.stringify(detections))throw Error(`Repeat detector output changed: ${frame.frameKey}`)
        }
        output.push({frameKey:frame.frameKey,width:frame.width,height:frame.height,inferenceMs,detections,relationships:frame.candidates.map(c=>({candidateId:c.id,diagnostics:posePersonRelationships(c.joints,detections)}))})
        setResults([...output]);publish();await new Promise(resolve=>setTimeout(resolve,0))
      }
      setStatus(`Complete: ${output.length} frames. Diagnostics only; no pose decisions.`)
    } catch(e){setStatus(`Stopped: ${String(e)}. Completed results remain exportable.`)}
    finally{detector?.close();lock.current=false;setRunning(false)}
  }
  const frame=session?.frames[selected],result=results.find(r=>r.frameKey===frame?.frameKey),candidate=frame?.candidates.find(c=>c.id===pose)
  const save=()=>{const url=URL.createObjectURL(new Blob([exportText],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='person-evidence-browser-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  return <main style={{padding:24,maxWidth:1400,margin:'auto'}}>
    <h1>Independent person evidence — development research</h1>
    <p>Zero product authority. Cyan: frozen visual annotation. Orange: EfficientDet output. Magenta: archived raw pose. IDs are frame-local. Missing boxes and outside limbs do not reject poses.</p>
    <label>Frozen development session <input aria-label="Frozen development session" type="file" accept=".json" disabled={running} onChange={e=>void load(e.target.files?.[0])}/></label>
    <label>Local EfficientDet model <input aria-label="Local EfficientDet model" type="file" accept=".tflite" disabled={running} onChange={e=>setModel(e.target.files?.[0]??null)}/></label>
    <button onClick={()=>void run()} disabled={!session||!model||running}>Run frozen person evidence</button>
    <p role="status">{status}</p>
    {frame&&<>
      <label>Frame <select aria-label="Evidence frame" value={selected} onChange={e=>{setSelected(Number(e.target.value));setPose('')}}>{session!.frames.map((f,i)=><option key={f.frameKey} value={i}>{f.frameKey} {f.video}</option>)}</select></label>
      <label>Archived pose <select aria-label="Archived pose" value={pose} onChange={e=>setPose(e.target.value)}><option value="">None</option>{frame.candidates.map(c=><option key={c.id} value={c.id}>{c.id} {c.source} {c.label}</option>)}</select></label>
      <svg aria-label="Person evidence overlay" role="img" viewBox={`0 0 ${frame.width} ${frame.height}`} style={{width:'100%',maxHeight:850,background:'#111'}}>
        <image href={frame.imageDataUrl} width={frame.width} height={frame.height}/>
        {frame.annotations.map(a=><g key={a.id}><rect x={a.box.x*frame.width} y={a.box.y*frame.height} width={a.box.width*frame.width} height={a.box.height*frame.height} fill="none" stroke="cyan" strokeWidth={2} strokeDasharray="8 4"/><text x={a.box.x*frame.width} y={a.box.y*frame.height-4} fill="cyan" fontSize={16}>{a.id}</text></g>)}
        {result?.detections.map(b=><g key={b.id}><rect x={b.pixels.x} y={b.pixels.y} width={b.pixels.width} height={b.pixels.height} fill="none" stroke="orange" strokeWidth={3}/><text x={b.pixels.x} y={b.pixels.y+18} fill="orange" fontSize={16}>{b.id} {b.score.toFixed(3)}</text></g>)}
        {candidate&&[[11,12],[11,23],[12,24],[23,24],[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[24,26],[26,28]].map(([a,b])=>candidate.joints[a]&&candidate.joints[b]&&<line key={`${a}-${b}`} x1={candidate.joints[a].x*frame.width} y1={candidate.joints[a].y*frame.height} x2={candidate.joints[b].x*frame.width} y2={candidate.joints[b].y*frame.height} stroke="magenta" strokeWidth={3}/>)}
      </svg>
    </>}
    <button disabled={!exportText} onClick={save}>Export person evidence</button>
    <details><summary>Browser results JSON</summary><textarea aria-label="Person evidence results" readOnly value={exportText} style={{width:'100%',height:400}}/></details>
  </main>
}
