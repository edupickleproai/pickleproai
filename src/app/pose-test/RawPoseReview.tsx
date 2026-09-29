"use client"

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { RESEARCH_JOINTS, RESEARCH_LIMBS, type ResearchPoint } from '@/lib/pose-research'
import { adjacentReview, fitPlayer, poseBounds, rawDisplayPoints, reviewIds, zoomView, type BlindedLabel, type ReviewAction, type Reviewable } from '@/lib/research-review'
import styles from './RawPoseReview.module.css'

export type ReviewRecord = Reviewable & {
  stage: 'raw'; video: string; fingerprint: string; requestedTime: number; actualTime: number;
  frameId: string; frameFingerprint: string; sourceImageFingerprint: string; source: string; passPose: number; poseIndex: number;
  measurements: unknown; image: string; rawImage: string; width: number; height: number; rawWidth: number; offsetX: number; points: ResearchPoint[]
}
type Props = { records: ReviewRecord[]; selectedId: string | null; onSelect: (id: string) => void; onAction: (id: string, action: ReviewAction) => void; assess: (measurements: any) => unknown }

export default function RawPoseReview(props: Props) {
  const [open, setOpen] = useState(false)
  const [unlabeled, setUnlabeled] = useState(false)
  const ids = reviewIds(props.records, unlabeled)
  const id = ids.includes(props.selectedId ?? '') ? props.selectedId : ids[0]
  const row = props.records.find(record => record.id === id)
  const opener = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous; opener.current?.focus() }
  }, [open])
  if (process.env.NODE_ENV !== 'development') return null
  const index = ids.indexOf(id ?? '')
  return <>
    <button ref={opener} disabled={!props.records.length} onClick={() => setOpen(true)} className="border p-2">Open blinded raw-pose review ({props.records.length})</button>
    <p>Frozen review pixels and raw coordinates exist only in this live session. JSON exports cannot restore overlays after reload. No recapture occurs when reviewing.</p>
    {open && createPortal(<div role="dialog" aria-modal="true" aria-label="Blinded raw pose review" className={styles.workspace} onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
      <header className={styles.header}><strong>Raw pose review · RESEARCH ONLY</strong><button autoFocus onClick={() => setOpen(false)}>Close review</button></header>
      <nav className={styles.controls} aria-label="Review navigation">
        <button disabled={index <= 0} onClick={() => { const next = adjacentReview(ids, id ?? null, -1); if (next) props.onSelect(next) }}>PREVIOUS</button>
        <span aria-live="polite">Record {row ? index + 1 : 0} of {ids.length}</span>
        <button disabled={index < 0 || index >= ids.length - 1} onClick={() => { const next = adjacentReview(ids, id ?? null, 1); if (next) props.onSelect(next) }}>NEXT</button>
        <label><input type="checkbox" checked={unlabeled} onChange={event => setUnlabeled(event.target.checked)}/> UNLABELED ONLY</label>
      </nav>
      {row ? <ReviewPose key={row.id} row={row} onAction={props.onAction} assess={props.assess}/> : <p>No raw detections match this filter.</p>}
    </div>, document.body)}
  </>
}

export function ReviewPose({ row, onAction, assess }: { row: ReviewRecord; onAction: Props['onAction']; assess: Props['assess'] }) {
  const points = rawDisplayPoints(row.points, row.rawWidth, row.height, row.offsetX)
  const bounds = poseBounds(RESEARCH_JOINTS.map(i => points[i]).filter(Boolean))
  const playerView = () => fitPlayer(RESEARCH_JOINTS.map(i => points[i]).filter(Boolean), row.width, row.height)
  const [view, setView] = useState(playerView)
  const [draft, setDraft] = useState<BlindedLabel | ''>(row.label === 'UNLABELED' ? '' : row.label)
  const [note, setNote] = useState(row.note)
  const [revision, setRevision] = useState<BlindedLabel | ''>('')
  const [reason, setReason] = useState('')
  const drag = useRef<{ x: number; y: number } | null>(null)
  const revealed = Boolean(row.review?.revealedAt)
  const radius = Math.max(view.width, view.height) / 180
  const status = revealed ? 'REVIEWED' : row.label === 'UNLABELED' ? 'UNLABELED' : 'LABELED'
  return <article className={styles.record} aria-label="Single raw detection">
    <p className={styles.reference}>{status} · {row.source} · raw pass {row.passPose} · frame-local #{row.poseIndex}</p>
    <svg role="img" aria-label="Blinded raw pose overlay" data-record-id={row.id} data-frame-fingerprint={row.frameFingerprint} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} className={styles.image} onPointerDown={event => { drag.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onPointerMove={event => {
      if (!drag.current) return
      const rect = event.currentTarget.getBoundingClientRect(), scale = Math.max(view.width / rect.width, view.height / rect.height)
      const dx = (event.clientX - drag.current.x) * scale, dy = (event.clientY - drag.current.y) * scale
      drag.current = { x: event.clientX, y: event.clientY }; setView(old => ({ ...old, x: old.x - dx, y: old.y - dy }))
    }}>
      <title>Selected raw skeleton on its associated frozen frame. Drag to pan; FIT FRAME restores surrounding players.</title>
      <image href={row.image} x={0} y={0} width={row.width} height={row.height}/>
      {bounds && <rect {...bounds} fill="none" stroke="#facc15" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeDasharray="6 4"/>}
      {[...RESEARCH_LIMBS, [11,12], [23,24], [11,23], [12,24]].map(([a,b]) => points[a] && points[b] && <g key={`${a}-${b}`}>
        <line x1={points[a].x} y1={points[a].y} x2={points[b].x} y2={points[b].y} stroke="#111827" strokeWidth={6} vectorEffect="non-scaling-stroke"/>
        <line x1={points[a].x} y1={points[a].y} x2={points[b].x} y2={points[b].y} stroke="#00ffff" strokeWidth={3} vectorEffect="non-scaling-stroke"/>
      </g>)}
      {RESEARCH_JOINTS.map(i => points[i] && <g key={i}><circle cx={points[i].x} cy={points[i].y} r={radius} fill="#ff4d86" stroke="white" strokeWidth={1} vectorEffect="non-scaling-stroke"/><text x={points[i].x + radius * 1.5} y={points[i].y - radius} fontSize={radius * 3.5} fill="white" stroke="black" strokeWidth={radius / 3} paintOrder="stroke">{i}</text></g>)}
    </svg>
    <div className={styles.controls} aria-label="Image view controls">
      <button onClick={() => setView(playerView())}>FIT PLAYER</button><button onClick={() => setView({x:0,y:0,width:row.width,height:row.height})}>FIT FRAME</button>
      <button onClick={() => setView(old => zoomView(old,.7,row.width,row.height))}>ZOOM IN</button><button onClick={() => setView(old => zoomView(old,1/.7,row.width,row.height))}>ZOOM OUT</button><button onClick={() => setView(playerView())}>RESET</button>
    </div>
    <p className={styles.hint}>Drag the image to pan. FIT FRAME shows all captured context. Only this raw skeleton is overlaid; pose numbers do not identify a player.</p>
    <details><summary>Exact record provenance</summary><dl className={styles.metadata}>
      {Object.entries({Video:row.video,'Source ID':row.fingerprint,'Requested seconds':row.requestedTime,'Presented seconds':row.actualTime,'Frozen frame fingerprint':row.frameFingerprint,'Raw input fingerprint':row.sourceImageFingerprint,'Frame ID':row.frameId,'Detection source':row.source,'Raw pass':row.passPose,'Frame-local index':row.poseIndex}).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
    </dl></details>
    <fieldset className={styles.labels}><legend>1. Commit a blinded visual label</legend>
      <label>Visual label <select aria-label="Blinded visual label" disabled={revealed} value={draft} onChange={event => setDraft(event.target.value as BlindedLabel)}><option value="">Choose a label</option>{['COHERENT','MALFORMED','UNCERTAIN'].map(label => <option key={label}>{label}</option>)}</select></label>
      <label>Research note <textarea aria-label="Blinded review note" disabled={revealed} maxLength={500} value={note} onChange={event => setNote(event.target.value)}/></label>
      <button disabled={!draft || revealed} onClick={() => { if (draft) onAction(row.id,{type:'commit',label:draft,note,at:new Date().toISOString()}) }}>Commit visual label</button>
      <p>Committed blinded label: {row.label}. No label is selected automatically.</p>
    </fieldset>
    <div className={styles.labels}><p>2. Reveal only after committing your visual label.</p><button disabled={row.label==='UNLABELED'||revealed} onClick={() => onAction(row.id,{type:'reveal',at:new Date().toISOString()})}>Reveal Shadow result</button></div>
    {revealed && <div className={styles.labels}>
      <p>Original blinded label locked: {row.review?.originalLabel}. Shadow has no product authority.</p>
      <pre aria-label="Revealed Shadow result">{JSON.stringify(assess(row.measurements),null,2)}</pre>
      <details><summary>Fixed measurements after reveal</summary><pre>{JSON.stringify(row.measurements,null,2)}</pre></details>
      <details><summary>Explicit post-reveal adjudication</summary><p>The original blinded label remains unchanged in the validation label field.</p>
        <label>Revised label <select aria-label="Adjudicated label" value={revision} onChange={event => setRevision(event.target.value as BlindedLabel)}><option value="">Choose revised label</option>{['COHERENT','MALFORMED','UNCERTAIN'].map(label => <option key={label}>{label}</option>)}</select></label>
        <label>Adjudication reason <textarea aria-label="Adjudication reason" maxLength={1000} value={reason} onChange={event => setReason(event.target.value)}/></label>
        <button disabled={!revision||!reason.trim()} onClick={() => { if (revision && reason.trim()) { onAction(row.id,{type:'adjudicate',label:revision,reason,at:new Date().toISOString()}); setReason(''); setRevision('') } }}>Record adjudication</button>
      </details>
      {row.review?.adjudications.map((entry,index) => <p key={index}>{entry.originalLabel} → {entry.revisedLabel}: {entry.reason} ({entry.at})</p>)}
    </div>}
  </article>
}
