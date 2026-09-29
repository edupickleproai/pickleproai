"use client"

import { useEffect, useRef, useState } from 'react'
import ResearchVideoSource, { type ResearchVideo } from './ResearchVideoSource'
import { assessPoseCoherence } from '@/lib/pose-coherence'
import { captureResearchFrame, assertFrozenInput, imageFingerprint, ResearchTransactions, researchExport, downloadResearchJson, type FrozenResearchFrame, type CaptureTiming, runResearchBatch, type ResearchBatchResult, type CaptureAttempt, ResearchCaptureError } from '@/lib/research-capture'
import { labelResearch, measurePose, researchId, RESEARCH_JOINTS, RESEARCH_LIMBS, type ResearchLabel, type ResearchPoint } from '@/lib/pose-research'

type Frame = { frameId: string; timestampSeconds: number; imageDataUrl: string }
type Pose = { poseIndex: number; landmarks: ResearchPoint[]; bbox: {left:number;top:number;width:number;height:number} }
type Trace = { sourceImage: string; records: Array<{poseIndex:number; raw:{source:string;passPose:number;input:string;width:number;height:number;sx:number;fullWidth:number;landmarks:ResearchPoint[]}; final:Pose;retained:boolean;suppressedBy:number|null;overlaps:Array<{poseIndex:number;iou:number}>}> }
type Capture = { id:string;video:string;fingerprint:string;frame:FrozenResearchFrame;trace:Trace }
type Row = {id:string;captureId:string;video:string;fingerprint:string;timestamp:number;frameId:string;source:string;passPose:number;poseIndex:number;stage:'raw'|'final';requestedTime:number;actualTime:number;frameFingerprint:string;detectorInputFingerprint:string;sourceImageFingerprint:string;timing:CaptureTiming;label:ResearchLabel;note:string;measurements:ReturnType<typeof measurePose>}

function Overlay({image,points,width,height,name}:{image:string;points:ResearchPoint[];width:number;height:number;name:string}) {
  return <svg role="img" aria-label={name} viewBox={`0 0 ${width} ${height}`} className="w-full max-w-3xl max-h-[700px]">
    <image href={image} width={width} height={height}/>
    {[...RESEARCH_LIMBS,[11,12],[23,24],[11,23],[12,24]].map(([a,b])=>points[a]&&points[b]&&<line key={`${a}-${b}`} x1={points[a].x*width} y1={points[a].y*height} x2={points[b].x*width} y2={points[b].y*height} stroke="#ff4757" strokeWidth={2}/>)}
    {RESEARCH_JOINTS.map(i=>points[i]&&<text key={i} x={points[i].x*width} y={points[i].y*height} fill="white" stroke="black" strokeWidth={.3} fontSize={12}>{i}</text>)}
  </svg>
}

// This component owns all research state. Its only parent callback returns detection snapshots.
// No product-state setters, reference enrollment, storage, or API clients are available here.
export default function RawPoseResearch({video:uploadedVideo,videoUrl:uploadedUrl,fingerprint:uploadedFingerprint,frames:uploadedFrames,busy,detect}:{video:string;videoUrl:string|null;fingerprint:string|null;frames:Frame[];busy:boolean;detect:(image:HTMLImageElement)=>Promise<Trace>}) {
  const [localSource,setLocalSource]=useState<{video:ResearchVideo;ready:boolean}|null>(null)
  const video=localSource?.video.filename??uploadedVideo
  const videoUrl=localSource?(localSource.ready?localSource.video.url:null):uploadedUrl
  const fingerprint=localSource?.video.id??uploadedFingerprint
  const frames=localSource?[]:uploadedFrames
  const [selectedFrame,setSelectedFrame]=useState('')
  const [timestamp,setTimestamp]=useState('0')
  const [captures,setCaptures]=useState<Capture[]>([])
  const [rows,setRows]=useState<Row[]>([])
  const [active,setActive]=useState<string|null>(null)
  const [running,setRunning]=useState(false)
  const [message,setMessage]=useState('')
  const [exportText,setExportText]=useState('')
  const [batchTimes,setBatchTimes]=useState('')
  const [batchResults,setBatchResults]=useState<Array<ResearchBatchResult & {video:string;runId:string}>>([])
  const [attemptLog,setAttemptLog]=useState<CaptureAttempt[]>([])
  const transactions=useRef(new ResearchTransactions())
  const controller=useRef<AbortController|null>(null)
  const processing=useRef(false)
  const diagnosticSession=useRef(0)
  const source=useRef({fingerprint,videoUrl})
  if(source.current.fingerprint!==fingerprint||source.current.videoUrl!==videoUrl){
    controller.current?.abort('SOURCE_CHANGE');transactions.current.cancel();source.current={fingerprint,videoUrl}
  }
  useEffect(()=>()=>{diagnosticSession.current++;controller.current?.abort();transactions.current.cancel()},[])
  const changeResearchSource=(next:ResearchVideo|null,ready:boolean)=>{
    controller.current?.abort('SOURCE_CHANGE');transactions.current.cancel()
    setLocalSource(next?{video:next,ready}:null)
    setSelectedFrame('');setTimestamp('0');setBatchTimes('');setActive(null);setExportText('');setMessage('')
    // Completed records retain their original source; in-flight work keeps its lock until it settles.
  }
  const run=async(times:number[])=>{
    if(busy||processing.current||!videoUrl||!fingerprint)return
    if(captures.length+times.length>100){setMessage('Session limit: 100 captures. Clear research session before collecting more.');return}
    const token=transactions.current.begin();if(token===null)return
    processing.current=true
    const session=diagnosticSession.current
    const abort=new AbortController();controller.current=abort
    setRunning(true);setMessage('Capturing and verifying presented frame…');setExportText('')
    try {
      await runResearchBatch(times,abort.signal,async(time,index)=>{
      // Product thumbnails have no presented-time proof; recapture their timestamp independently.
      const frame=await captureResearchFrame(videoUrl,time,`research-${token}-${index}-${time}`,abort.signal,{sourceId:fingerprint,onAttempt:attempt=>{if(diagnosticSession.current===session)setAttemptLog(old=>[...old,attempt])}})
      if(!transactions.current.current(token)||abort.signal.aborted)throw new ResearchCaptureError(abort.signal.reason==='SOURCE_CHANGE'?'SOURCE_CHANGE':'STALE_TRANSACTION','Research capture cancelled.')
      const image=new Image()
      await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('Research frame could not load.'));image.src=frame!.imageDataUrl})
      if(!transactions.current.current(token)||abort.signal.aborted)throw new ResearchCaptureError(abort.signal.reason==='SOURCE_CHANGE'?'SOURCE_CHANGE':'STALE_TRANSACTION','Research capture cancelled.')
      assertFrozenInput(frame,image.src)
      const trace=await detect(image)
      if(!transactions.current.current(token)||abort.signal.aborted)throw new ResearchCaptureError(abort.signal.reason==='SOURCE_CHANGE'?'SOURCE_CHANGE':'STALE_TRANSACTION','Research capture cancelled.')
      assertFrozenInput(frame,trace.sourceImage)
      const id=JSON.stringify([fingerprint,frame.frameId])
      const capture:Capture={id,video,fingerprint,frame,trace}
      const newRows=trace.records.flatMap(record=>{
        const r=record.raw
        const overlap=record.overlaps.filter(o=>trace.records.some(t=>t.poseIndex===o.poseIndex&&t.retained))
        const maxIou=Math.max(0,...overlap.map(o=>o.iou))
        return (record.retained?['raw','final']:['raw']).map(stage=>({id:researchId(fingerprint,frame!.frameId,r.source,r.passPose,stage as 'raw'|'final'),captureId:id,video,fingerprint,timestamp:frame!.timestampSeconds,frameId:frame!.frameId,source:r.source,passPose:r.passPose,poseIndex:record.poseIndex,stage:stage as 'raw'|'final',requestedTime:frame.timing.requestedTime,actualTime:frame.timing.actualTime,frameFingerprint:frame.imageFingerprint,detectorInputFingerprint:imageFingerprint(trace.sourceImage),sourceImageFingerprint:imageFingerprint(stage==='raw'?r.input:frame.imageDataUrl),timing:frame.timing,label:'UNLABELED' as ResearchLabel,note:'',measurements:stage==='raw'?measurePose(r.landmarks,r.width,r.height,maxIou):measurePose(record.final.landmarks,r.fullWidth,r.height,maxIou)}))
      })
      setCaptures(old=>[...old.filter(c=>c.id!==id),capture]);setRows(old=>[...old.filter(r=>r.captureId!==id),...newRows]);setActive(newRows[0]?.id??null)
      setMessage(`VERIFIED: requested ${frame.timing.requestedTime.toFixed(6)}s; presented ${frame.timing.actualTime.toFixed(6)}s. ${trace.records.length} raw poses; ${trace.records.filter(r=>r.retained).length} retained candidates. No identity assigned.`)
      return frame
      }, result=>{if(diagnosticSession.current===session)setBatchResults(old=>[...old,{...result,video,runId:String(token)}]);if(transactions.current.current(token)&&result.status==='REJECTED')setMessage(result.reason??'Capture rejected.')})
    } catch(e){if(transactions.current.current(token))setMessage(e instanceof Error?e.message:'Research capture failed.')}finally{
      if(transactions.current.current(token))transactions.current.finish(token)
      processing.current=false;setRunning(false)
    }
  }
  const inspect=async()=>{
    const selected=frames.find(f=>f.frameId===selectedFrame)
    if(!selected&&!timestamp.trim()){setMessage('Enter a valid timestamp.');return}
    await run([selected?.timestampSeconds??Number(timestamp)])
  }
  const batch=async()=>{
    const values=batchTimes.trim().split(/[\s,]+/).map(Number)
    if(!batchTimes.trim()||values.length>100||values.some(t=>!Number.isFinite(t)||t<0)){setMessage('Enter 1–100 valid timestamps, separated by commas or spaces.');return}
    await run(values)
  }
  const row=rows.find(r=>r.id===active),capture=captures.find(c=>c.id===row?.captureId),record=capture?.trace.records.find(r=>r.poseIndex===row?.poseIndex)
  const exportRows=()=>{const json=researchExport(rows);setExportText(json);downloadResearchJson(json)}

  return <section className="my-6 border border-cyan-800 p-4 space-y-3" aria-label="Raw pose research">
    <h2>Raw Pose Research — development only</h2>
    {process.env.NODE_ENV==='development'&&<ResearchVideoSource onChange={changeResearchSource}/>}
    <p>Zero authority. Inspect raw alignment first; measurements are collapsed. Labels/notes stay in memory and never become identity or coaching evidence. Pose indices are frame-local.</p>
    <p>Capture requires a presented-frame timestamp and two following frames with consistent cadence. Unsupported browsers, irregular or missed presentations, and clips too near the end remain UNVERIFIED and create no record. Repeated captures keep separate IDs and labels.</p>
    <label>Research frame (recaptured independently) <select disabled={running} aria-label="Research frame" value={selectedFrame} onChange={e=>setSelectedFrame(e.target.value)} className="bg-slate-800"><option value="">Extract research timestamp</option>{frames.map(f=><option key={f.frameId} value={f.frameId}>{f.timestampSeconds.toFixed(3)}s · {f.frameId}</option>)}</select></label>
    <label>Research timestamp <input disabled={running} aria-label="Research timestamp" type="number" min="0" step="0.001" value={timestamp} onChange={e=>{setTimestamp(e.target.value);setSelectedFrame('')}} className="bg-slate-800"/></label>
    <button disabled={running||busy||!videoUrl} onClick={inspect} className="border p-2">Inspect research frame</button>
    <label>Batch timestamps <input aria-label="Research batch timestamps" disabled={running} value={batchTimes} onChange={e=>setBatchTimes(e.target.value)} className="bg-slate-800"/></label>
    <button disabled={running||busy||!videoUrl} onClick={batch}>Run research batch</button>
    <button disabled={!running} onClick={()=>{controller.current?.abort();setMessage('Cancelling research capture…')}}>Cancel research capture</button>
    <p>Keep this page visible during capture; background presentation throttling can cause safe rejection.</p>
    <p>Batch uses the current video and the exact timestamp order entered. Up to three attempts per timestamp; no automatic labels.</p>
    <details><summary>Research batch diagnostics ({batchResults.length} completed)</summary>
      <textarea aria-label="Research batch results" readOnly rows={8} value={JSON.stringify({authority:'NONE',results:batchResults,attempts:attemptLog},null,2)} className="w-full bg-slate-900"/>
    </details>
    <button disabled={running||!batchResults.length} onClick={()=>downloadResearchJson(JSON.stringify({authority:'NONE',results:batchResults,attempts:attemptLog},null,2),`research-capture-diagnostics-${Date.now()}.json`)}>Export batch diagnostics</button>
    <p role="status">{message}</p>
    <button onClick={exportRows} disabled={running||!rows.length}>Export research JSON (no images)</button>{' '}
    <button disabled={running} onClick={()=>{diagnosticSession.current++;transactions.current.cancel();setRows([]);setCaptures([]);setActive(null);setExportText('');setMessage('Research session cleared.');setBatchResults([]);setAttemptLog([])}}>Clear research session</button>
    {exportText&&<details open><summary>Research JSON export preview</summary><p>Download requested. This is a snapshot; export again after edits. If this browser blocks downloads, copy this exact JSON into a file outside the repository.</p><textarea aria-label="Research JSON export" readOnly value={exportText} rows={8} className="w-full bg-slate-900"/></details>}
    <table className="text-xs w-full"><thead><tr>{['Video','Requested / presented','Source','Stage / reference','Label','Note','View'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.video}</td><td>{r.requestedTime.toFixed(3)} / {r.actualTime.toFixed(6)}</td><td>{r.source}</td><td>{r.stage} · pass {r.passPose} · frame #{r.poseIndex}</td><td>{r.label}</td><td>{r.note}</td><td><button onClick={()=>setActive(r.id)} aria-label={`View ${r.stage} ${r.timestamp.toFixed(3)} ${r.source} ${r.passPose}`}>View</button></td></tr>)}</tbody></table>
    {row&&capture&&record&&<div>
      <h3>{row.stage==='raw'?'RAW detector input':'FINAL retained full-frame candidate'} · {row.timestamp.toFixed(3)}s · {row.source} · pass {row.passPose}</h3>
      <p>Raw source: {record.raw.source}/{record.raw.passPose} → frame-local #{record.poseIndex}. {record.retained?'Retained by existing dedup':`Suppressed by frame-local #${record.suppressedBy}`}</p>
      <details><summary>Capture integrity</summary><pre aria-label="Capture diagnostics">{JSON.stringify({frameId:row.frameId,frameFingerprint:row.frameFingerprint,detectorInputFingerprint:row.detectorInputFingerprint,sourceImageFingerprint:row.sourceImageFingerprint,width:capture.frame.width,height:capture.frame.height,...row.timing},null,2)}</pre></details>
      <Overlay name="Research pose overlay" image={row.stage==='raw'?record.raw.input:capture.frame.imageDataUrl} points={row.stage==='raw'?record.raw.landmarks:record.final.landmarks} width={row.stage==='raw'?record.raw.width:record.raw.fullWidth} height={record.raw.height}/>
      <label>Research label <select aria-label="Research label" value={row.label} onChange={e=>setRows(old=>labelResearch(old,row.id,e.target.value as ResearchLabel,row.note))} className="bg-slate-800">{['UNLABELED','COHERENT','MALFORMED','UNCERTAIN'].map(l=><option key={l}>{l}</option>)}</select></label>
      <label>Research note <input aria-label="Research note" maxLength={500} value={row.note} onChange={e=>setRows(old=>labelResearch(old,row.id,row.label,e.target.value))} className="bg-slate-800"/></label>
      <details><summary>Fixed coherence measurements</summary><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(row.measurements,null,2)}</pre></details>
      <details key={row.id}><summary>Shadow pose diagnostics — reveal after visual labeling</summary>
        <p>RESEARCH ONLY — NO PRODUCT AUTHORITY</p>
        <p>No obvious anomaly is not approval. Suspicion is not rejection. Manual labels remain independent.</p>
        <pre aria-label="Shadow pose assessment" className="text-xs whitespace-pre-wrap">{JSON.stringify(assessPoseCoherence(row.measurements),null,2)}</pre>
      </details>
      <details><summary>Raw / final coordinates and provenance</summary><pre className="text-xs whitespace-pre-wrap">{JSON.stringify({authority:'NONE',frameId:row.frameId,timestamp:row.timestamp,source:record.raw.source,passPose:record.raw.passPose,inputDimensions:{width:record.raw.width,height:record.raw.height},cropBounds:{x:record.raw.sx,y:0,width:record.raw.width,height:record.raw.height},rawLandmarks:record.raw.landmarks,rawBbox:{left:Math.min(...record.raw.landmarks.map(p=>p.x))*record.raw.width,top:Math.min(...record.raw.landmarks.map(p=>p.y))*record.raw.height,width:(Math.max(...record.raw.landmarks.map(p=>p.x))-Math.min(...record.raw.landmarks.map(p=>p.x)))*record.raw.width,height:(Math.max(...record.raw.landmarks.map(p=>p.y))-Math.min(...record.raw.landmarks.map(p=>p.y)))*record.raw.height},final:record.final,retained:record.retained,suppressedBy:record.suppressedBy,overlaps:record.overlaps},null,2)}</pre></details>
    </div>}
  </section>
}
