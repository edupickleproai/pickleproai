// Measurement-only research helpers. No qualification, identity, or coaching imports.
export type ResearchPoint = { x: number; y: number; visibility?: number }
export type ResearchLabel = 'UNLABELED' | 'COHERENT' | 'MALFORMED' | 'UNCERTAIN'
export const RESEARCH_LIMBS = [[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[24,26],[26,28]]
export const RESEARCH_JOINTS = [11,12,13,14,15,16,23,24,25,26,27,28]
const finite = (n: number) => Number.isFinite(n) ? n : null
export function measurePose(points: ResearchPoint[], width: number, height: number, maxRetainedIou: number | null = null) {
  if (!(width > 0 && height > 0) || !points.length || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || RESEARCH_JOINTS.some(i => !points[i])) return { unavailable: 'Invalid coordinates or missing measurement joints' }
  const p = points.map(p => ({ x: p.x * width / height, y: p.y }))
  const dist = (a: ResearchPoint,b: ResearchPoint) => Math.hypot(a.x-b.x,a.y-b.y)
  const mid = (a: ResearchPoint,b: ResearchPoint) => ({x:(a.x+b.x)/2,y:(a.y+b.y)/2})
  const box = (ps: ResearchPoint[]) => { const xs=ps.map(p=>p.x),ys=ps.map(p=>p.y); return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)} }
  const b=box(p), s=mid(p[11],p[12]), h=mid(p[23],p[24]), m=mid(s,h), torso=dist(s,h)
  const lengths=RESEARCH_LIMBS.map(([a,b])=>dist(p[a],p[b]))
  const ratio=(a:number,b:number)=>finite(b===0?NaN:a/b)
  const cosine=(a:ResearchPoint,b:ResearchPoint)=>ratio(a.x*b.x+a.y*b.y,Math.hypot(a.x,a.y)*Math.hypot(b.x,b.y))
  const angle=(a:number,b:number,c:number)=>{const v=cosine({x:p[a].x-p[b].x,y:p[a].y-p[b].y},{x:p[c].x-p[b].x,y:p[c].y-p[b].y});return v===null?null:Math.acos(Math.max(-1,Math.min(1,v)))*180/Math.PI}
  const asym=[[0,2],[1,3],[4,6],[5,7]].map(([a,b])=>ratio(Math.max(lengths[a],lengths[b]),Math.min(lengths[a],lengths[b])))
  const distal=[15,16,27,28].map(i=>dist(p[i],m))
  const visibility=RESEARCH_JOINTS.map(i=>points[i].visibility)
  const validVisibility=visibility.every(v=>typeof v==='number'&&Number.isFinite(v))
  return {
    basis:'x * image width / image height; y unchanged; area/center relative to this input',
    bodyHeight:b.h, bboxAspect:ratio(b.w,b.h), bboxArea: b.w*b.h*height/width,
    center:{x:(b.x+b.w/2)*height/width,y:b.y+b.h/2}, torsoLength:torso,
    shoulderHipDeltaY:s.y-h.y, shoulderHipOrdering:s.y<h.y?'ABOVE':s.y>h.y?'BELOW':'LEVEL',
    torsoAngle:torso===0?null:Math.atan2(s.x-h.x,h.y-s.y)*180/Math.PI,
    limbTorsoRatios:lengths.map(l=>ratio(l,torso)), leftRightAsymmetry:asym,
    largestLeftRightAsymmetry:asym.every(a=>a!==null)?Math.max(...asym as number[]):null,
    distalTorsoMin:ratio(Math.min(...distal),torso),distalTorsoMax:ratio(Math.max(...distal),torso),
    elbowAngles:[angle(11,13,15),angle(12,14,16)],kneeAngles:[angle(23,25,27),angle(24,26,28)],
    sideVectorCosine:cosine({x:p[12].x-p[11].x,y:p[12].y-p[11].y},{x:p[24].x-p[23].x,y:p[24].y-p[23].y}),
    torsoBboxDiagonal:ratio(torso,Math.hypot(b.w,b.h)),
    maxSinglePointAreaInfluence: b.w*b.h===0?null:Math.max(...p.map((_,i)=>{const rest=box(p.filter((_,j)=>i!==j));return 1-rest.w*rest.h/(b.w*b.h)})),
    maxRetainedIou, minVisibility:validVisibility?Math.min(...visibility as number[]):null,
    maxConnectedVisibilityGap:validVisibility?Math.max(...RESEARCH_LIMBS.map(([a,b])=>Math.abs(points[a].visibility!-points[b].visibility!))):null,
  }
}

export function researchId(video: string, frame: string, source: string, passPose: number, stage: 'raw'|'final') {
  return JSON.stringify([video,frame,source,passPose,stage])
}
export function labelResearch<T extends { id: string; label: ResearchLabel; note: string }>(rows: T[], id: string, label: ResearchLabel, note: string): T[] {
  return rows.map(row=>row.id===id?{...row,label,note}:row)
}
