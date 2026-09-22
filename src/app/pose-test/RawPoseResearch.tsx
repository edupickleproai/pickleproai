"use client"

import { useRef, useState } from 'react'
import { labelResearch, measurePose, researchId, RESEARCH_JOINTS, RESEARCH_LIMBS, type ResearchLabel, type ResearchPoint } from '@/lib/pose-research'

type Frame = { frameId: string; timestampSeconds: number; imageDataUrl: string }
type Pose = { poseIndex: number; landmarks: ResearchPoint[]; bbox: {left:number;top:number;width:number;height:number} }
type Trace = { sourceImage: string; records: Array<{poseIndex:number; raw:{source:string;passPose:number;input:string;width:number;height:number;sx:number;fullWidth:number;landmarks:ResearchPoint[]}; final:Pose;retained:boolean;suppressedBy:number|null;overlaps:Array<{poseIndex:number;iou:number}>}> }
type Capture = { id:string;video:string;fingerprint:string;frame:Frame;trace:Trace }
type Row = {id:string;captureId:string;video:string;fingerprint:string;timestamp:number;frameId:string;source:string;passPose:number;poseIndex:number;stage:'raw'|'final';label:ResearchLabel;note:string;measurements:ReturnType<typeof measurePose>}

function Overlay({image,points,width,height,name}:{image:string;points:ResearchPoint[];width:number;height:number;name:string}) {
  return <svg role="img" aria-label={name} viewBox={`0 0 ${width} ${height}`} className="w-full max-w-3xl max-h-[700px]">
    <image href={image} width={width} height={height}/>
    {[...RESEARCH_LIMBS,[11,12],[23,24],[11,23],[12,24]].map(([a,b])=>points[a]&&points[b]&&<line key={`${a}-${b}`} x1={points[a].x*width} y1={points[a].y*height} x2={points[b].x*width} y2={points[b].y*height} stroke="#ff4757" strokeWidth={2}/>)}
    {RESEARCH_JOINTS.map(i=>points[i]&&<text key={i} x={points[i].x*width} y={points[i].y*height} fill="white" stroke="black" strokeWidth={.3} fontSize={12}>{i}</text>)}
  </svg>
}

// This component owns all research state. Its only parent callback returns detection snapshots.
// No product-state setters, reference enrollment, storage, or API clients are available here.
export default function RawPoseResearch({video,videoUrl,fingerprint,frames,busy,detect}:{video:string;videoUrl:string|null;fingerprint:string|null;frames:Frame[];busy:boolean;detect:(image:HTMLImageElement)=>Promise<Trace>}) {
  const [selectedFrame,setSelectedFrame]=useState('')
  const [timestamp,setTimestamp]=useState('0')
  const [captures,setCaptures]=useState<Capture[]>([])
  const [rows,setRows]=useState<Row[]>([])
  const [active,setActive]=useState<string|null>(null)
  const [running,setRunning]=useState(false)
  const [message,setMessage]=useState('')
  const inFlight=useRef(false)
  const currentVideo=useRef(fingerprint);currentVideo.current=fingerprint
  const inspect=async()=>{
    if(inFlight.current||busy||!videoUrl||!fingerprint)return
    if(captures.length>=100){setMessage('Session limit: 100 captures. Clear research session before collecting more.');return}
    inFlight.current=true;setRunning(true);setMessage('Capturing research frame…')
    const startFingerprint=fingerprint
    let media:HTMLVideoElement|null=null
    try {
      let frame=frames.find(f=>f.frameId===selectedFrame)
      if(!frame){
        const time=Number(timestamp)
        if(!timestamp.trim()||!Number.isFinite(time)||time<0)throw new Error('Enter a valid timestamp.')
        media=document.createElement('video');media.muted=true;media.preload='auto'
        const v=media
        const wait=(event:string,action:()=>void)=>new Promise<void>((resolve,reject)=>{
          const clean=()=>{clearTimeout(timer);v.removeEventListener(event,ok);v.removeEventListener('error',bad)}
          const ok=()=>{clean();resolve()};const bad=()=>{clean();reject(new Error('Research video could not load/seek.'))}
          const timer=setTimeout(bad,15000);v.addEventListener(event,ok,{once:true});v.addEventListener('error',bad,{once:true});action()
        })
        await wait('loadeddata',()=>{v.src=videoUrl;v.load()})
        if(time>=v.duration)throw new Error('Timestamp must be before video end.')
        if(Math.abs(v.currentTime-time)>1e-6)await wait('seeked',()=>{v.currentTime=time})
        const canvas=document.createElement('canvas');const scale=Math.min(1,1280/v.videoWidth);canvas.width=Math.max(1,Math.round(v.videoWidth*scale));canvas.height=Math.max(1,Math.round(v.videoHeight*scale))
        const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas unavailable.')
        ctx.drawImage(v,0,0,canvas.width,canvas.height);frame={frameId:`research-${time}`,timestampSeconds:time,imageDataUrl:canvas.toDataURL('image/jpeg',.92)}
      }
      const image=new Image()
      await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('Research frame could not load.'));image.src=frame!.imageDataUrl})
      const trace=await detect(image)
      if(currentVideo.current!==startFingerprint){setMessage('Video changed; research capture discarded.');return}
      const id=JSON.stringify([fingerprint,frame.frameId])
      const capture:Capture={id,video,fingerprint,frame,trace}
      const newRows=trace.records.flatMap(record=>{
        const r=record.raw
        const overlap=record.overlaps.filter(o=>trace.records.some(t=>t.poseIndex===o.poseIndex&&t.retained))
        const maxIou=Math.max(0,...overlap.map(o=>o.iou))
        return (record.retained?['raw','final']:['raw']).map(stage=>({id:researchId(fingerprint,frame!.frameId,r.source,r.passPose,stage as 'raw'|'final'),captureId:id,video,fingerprint,timestamp:frame!.timestampSeconds,frameId:frame!.frameId,source:r.source,passPose:r.passPose,poseIndex:record.poseIndex,stage:stage as 'raw'|'final',label:'UNLABELED' as ResearchLabel,note:'',measurements:stage==='raw'?measurePose(r.landmarks,r.width,r.height,maxIou):measurePose(record.final.landmarks,r.fullWidth,r.height,maxIou)}))
      })
      setCaptures(old=>[...old.filter(c=>c.id!==id),capture]);setRows(old=>[...old.filter(r=>r.captureId!==id),...newRows]);setActive(newRows[0]?.id??null)
      setMessage(`${trace.records.length} raw poses; ${trace.records.filter(r=>r.retained).length} retained candidates. No identity assigned.`)
    } catch(e){setMessage(e instanceof Error?e.message:'Research capture failed.')}finally{if(media){media.removeAttribute('src');media.load()}inFlight.current=false;setRunning(false)}
  }
  const row=rows.find(r=>r.id===active),capture=captures.find(c=>c.id===row?.captureId),record=capture?.trace.records.find(r=>r.poseIndex===row?.poseIndex)
  const exportRows=()=>{const blob=new Blob([JSON.stringify({authority:'NONE',rows},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='pose-research.json';a.click();URL.revokeObjectURL(url)}
  return <section className="my-6 border border-cyan-800 p-4 space-y-3" aria-label="Raw pose research">
    <h2>Raw Pose Research — development only</h2>
    <p>Zero authority. Inspect raw alignment first; measurements are collapsed. Labels/notes stay in memory and never become identity or coaching evidence. Pose indices are frame-local.</p>
    <label>Research frame <select aria-label="Research frame" value={selectedFrame} onChange={e=>setSelectedFrame(e.target.value)} className="bg-slate-800"><option value="">Extract research timestamp</option>{frames.map(f=><option key={f.frameId} value={f.frameId}>{f.timestampSeconds.toFixed(3)}s · {f.frameId}</option>)}</select></label>
    <label>Research timestamp <input aria-label="Research timestamp" type="number" min="0" step="0.001" value={timestamp} onChange={e=>{setTimestamp(e.target.value);setSelectedFrame('')}} className="bg-slate-800"/></label>
    <button disabled={running||busy||!videoUrl} onClick={inspect} className="border p-2">Inspect research frame</button>
    <p role="status">{message}</p>
    <button onClick={exportRows} disabled={!rows.length}>Export research JSON (no images)</button>{' '}
    <button disabled={running} onClick={()=>{setRows([]);setCaptures([]);setActive(null);setMessage('Research session cleared.')}}>Clear research session</button>
    <table className="text-xs w-full"><thead><tr>{['Video','Time','Source','Stage / reference','Label','Note','View'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.video}</td><td>{r.timestamp.toFixed(3)}</td><td>{r.source}</td><td>{r.stage} · pass {r.passPose} · frame #{r.poseIndex}</td><td>{r.label}</td><td>{r.note}</td><td><button onClick={()=>setActive(r.id)} aria-label={`View ${r.stage} ${r.timestamp.toFixed(3)} ${r.source} ${r.passPose}`}>View</button></td></tr>)}</tbody></table>
    {row&&capture&&record&&<div>
      <h3>{row.stage==='raw'?'RAW detector input':'FINAL retained full-frame candidate'} · {row.timestamp.toFixed(3)}s · {row.source} · pass {row.passPose}</h3>
      <p>Raw source: {record.raw.source}/{record.raw.passPose} → frame-local #{record.poseIndex}. {record.retained?'Retained by existing dedup':`Suppressed by frame-local #${record.suppressedBy}`}</p>
      <Overlay name="Research pose overlay" image={row.stage==='raw'?record.raw.input:capture.frame.imageDataUrl} points={row.stage==='raw'?record.raw.landmarks:record.final.landmarks} width={row.stage==='raw'?record.raw.width:record.raw.fullWidth} height={record.raw.height}/>
      <label>Research label <select aria-label="Research label" value={row.label} onChange={e=>setRows(old=>labelResearch(old,row.id,e.target.value as ResearchLabel,row.note))} className="bg-slate-800">{['UNLABELED','COHERENT','MALFORMED','UNCERTAIN'].map(l=><option key={l}>{l}</option>)}</select></label>
      <label>Research note <input aria-label="Research note" maxLength={500} value={row.note} onChange={e=>setRows(old=>labelResearch(old,row.id,row.label,e.target.value))} className="bg-slate-800"/></label>
      <details><summary>Fixed coherence measurements</summary><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(row.measurements,null,2)}</pre></details>
      <details><summary>Raw / final coordinates and provenance</summary><pre className="text-xs whitespace-pre-wrap">{JSON.stringify({authority:'NONE',frameId:row.frameId,timestamp:row.timestamp,source:record.raw.source,passPose:record.raw.passPose,inputDimensions:{width:record.raw.width,height:record.raw.height},cropBounds:{x:record.raw.sx,y:0,width:record.raw.width,height:record.raw.height},rawLandmarks:record.raw.landmarks,rawBbox:{left:Math.min(...record.raw.landmarks.map(p=>p.x))*record.raw.width,top:Math.min(...record.raw.landmarks.map(p=>p.y))*record.raw.height,width:(Math.max(...record.raw.landmarks.map(p=>p.x))-Math.min(...record.raw.landmarks.map(p=>p.x)))*record.raw.width,height:(Math.max(...record.raw.landmarks.map(p=>p.y))-Math.min(...record.raw.landmarks.map(p=>p.y)))*record.raw.height},final:record.final,retained:record.retained,suppressedBy:record.suppressedBy,overlaps:record.overlaps},null,2)}</pre></details>
    </div>}
  </section>
}
