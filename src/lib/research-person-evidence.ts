// Descriptive research measurements only. No classifications or product decisions.
export const DEVELOPMENT_VIDEOS = ['V03','V04','V05','V07','V08','V09','V11','V12'] as const
export const PERSON_CONFIG = { runningMode: 'IMAGE' as const, scoreThreshold: 0.1, maxResults: -1, categoryAllowlist: ['person'], delegate: 'CPU' as const }
export const MODEL_SHA256 = '0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb'
export type Point = { x:number; y:number }
export type Box = Point & { width:number; height:number }
export type PersonBox = { id:string; category:'person'; score:number; pixels:Box; normalized:Box }
export type Candidate = { id:string; source:string; label:string; joints:Record<string,Point>; [key:string]:unknown }
export type Annotation = { id:string; box:Box; confidence:string; description:string }
export type EvidenceFrame = { frameKey:string; video:string; width:number; height:number; imageDataUrl:string; pngSha256:string; annotations:Annotation[]; candidates:Candidate[]; [key:string]:unknown }
export type EvidenceSession = { annotationsFrozenAt:string; annotationsSha256:string; frames:EvidenceFrame[]; [key:string]:unknown }
const finite = (v:number) => Number.isFinite(v)
// Archived research exports use compact {index,x,y} lists, not dense 33-slot arrays.
// Convert by explicit anatomical index without altering any coordinates.
export function normalizeSession(s:EvidenceSession):EvidenceSession {
  return {...s,frames:s.frames.map(f=>({...f,candidates:f.candidates.map(c=>{
    if(!Array.isArray(c.joints))return c
    const joints:Record<string,Point>={}
    for(const p of c.joints as Array<Point & {index:number}>) {
      if(!Number.isInteger(p.index)||p.index<0||p.index>32||joints[p.index])throw Error('Invalid or duplicate landmark index.')
      joints[p.index]={x:p.x,y:p.y}
    }
    return {...c,joints}
  })}))}
}
export function validateSession(s:EvidenceSession) {
  if (!s?.annotationsFrozenAt || !/^[a-f0-9]{64}$/.test(s.annotationsSha256) || !Array.isArray(s.frames) || !s.frames.length || s.frames.length>40) throw Error('A frozen annotation session is required.')
  const keys=new Set<string>()
  for(const f of s.frames) {
    if(!DEVELOPMENT_VIDEOS.includes(f.video as typeof DEVELOPMENT_VIDEOS[number])) throw Error('Development videos only.')
    if(keys.has(f.frameKey)) throw Error('Duplicate frame.'); keys.add(f.frameKey)
    if(!Number.isInteger(f.width)||!Number.isInteger(f.height)||f.width<=0||f.height<=0||f.width*f.height>16000000||!f.imageDataUrl?.startsWith('data:image/png;base64,')||!Array.isArray(f.annotations)||!Array.isArray(f.candidates)) throw Error('Invalid frame.')
    for(const c of f.candidates) {
      if(Array.isArray(c.joints)||!c.joints||typeof c.joints!=='object')throw Error('Normalize indexed landmarks before analysis.')
      if(c.video && c.video!==f.video) throw Error('Candidate source mismatch.')
      for(const p of Object.values(c.joints??{})) if(!finite(p.x)||!finite(p.y)) throw Error('Invalid coordinates.')
    }
  }
}
export function mapCropPoint(p:Point,crop:Box,full: {width:number;height:number}):Point {
  return {x:(crop.x+p.x*crop.width)/full.width,y:(crop.y+p.y*crop.height)/full.height}
}
export function personBoxes(detections:Array<{categories:Array<{categoryName:string;score:number}>;boundingBox?:{originX:number;originY:number;width:number;height:number}}>,width:number,height:number):PersonBox[] {
  if(width<=0||height<=0) throw Error('Invalid dimensions.')
  return detections.flatMap((d,i)=> {
    const c=d.categories.find(c=>c.categoryName==='person'), b=d.boundingBox
    if(!c||!b) return []
    if(![b.originX,b.originY,b.width,b.height,c.score].every(finite)||b.width<=0||b.height<=0) throw Error('Invalid detector box.')
    // Keep every returned person, including overlapping and low-score boxes. No extra NMS or clipping.
    return [{id:`BOX_${i+1}`,category:'person' as const,score:c.score,pixels:{x:b.originX,y:b.originY,width:b.width,height:b.height},normalized:{x:b.originX/width,y:b.originY/height,width:b.width/width,height:b.height/height}}]
  })
}
export function contains(b:Box,p:Point) { return p.x>=b.x&&p.y>=b.y&&p.x<=b.x+b.width&&p.y<=b.y+b.height }
export function boxIoU(a:Box,b:Box) {
  const intersection=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y))
  const union=a.width*a.height+b.width*b.height-intersection
  return union>0?intersection/union:0
}
const core=[11,12,13,14,15,16,23,24,25,26,27,28], torso=[11,12,23,24], arms=[13,14,15,16], legs=[25,26,27,28]
export function posePersonRelationships(joints:Record<string,Point>,boxes:PersonBox[]) {
  const present=core.filter(i=>joints[i]), t=torso.filter(i=>joints[i]), limbs=[...arms,...legs].filter(i=>joints[i])
  const points=present.map(i=>joints[i]), xs=points.map(p=>p.x),ys=points.map(p=>p.y)
  const bbox=points.length?{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}:null
  const midpoint=t.length?{x:t.reduce((n,i)=>n+joints[i].x,0)/t.length,y:t.reduce((n,i)=>n+joints[i].y,0)/t.length}:null
  const memberships=Object.fromEntries(present.map(i=>[i,boxes.filter(b=>contains(b.normalized,joints[i])).map(b=>b.id)]))
  return { authority:'NONE' as const, availableCoreLandmarks:present.length, poseBox:bbox, landmarkMemberships:memberships,
    boxes:boxes.map(b=>{
      const inside=present.filter(i=>contains(b.normalized,joints[i]))
      return {boxId:b.id,torsoCenterInside:midpoint?contains(b.normalized,midpoint):null,shoulderHipInside:t.filter(i=>inside.includes(i)),coreFractionInside:present.length?inside.length/present.length:null,
        armOutside:arms.filter(i=>joints[i]&&!inside.includes(i)),legOutside:legs.filter(i=>joints[i]&&!inside.includes(i)),limbFractionOutside:limbs.length?limbs.filter(i=>!inside.includes(i)).length/limbs.length:null,
        outsideInOtherBoxes:present.filter(i=>!inside.includes(i)&&memberships[i].length).map(i=>({joint:i,boxes:memberships[i]})),poseBoxIoU:bbox?boxIoU(bbox,b.normalized):null}
    }) }
}
