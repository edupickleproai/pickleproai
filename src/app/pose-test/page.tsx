"use client"

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import BiomechanicsPanel from './BiomechanicsPanel'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { detectPhases, matchPhaseTarget, overridePhase, phaseGeometry, scorePlayerMatch, planPhaseRefinement, refinePhases, type RefinementResult, type PhaseResult, type PhaseCandidate } from '@/lib/phase-detection'
import { buildCoachingBiomechanicsPayload, clearStoredVideoBiomechanics, COACHING_BIOMECHANICS_STORAGE_KEY, videoFingerprint } from '@/lib/coaching-biomechanics'

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
const WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'

interface PoseResult {
  poseIndex: number
  landmarks: NormalizedLandmark[]
  worldLandmarks?: any[] | null
  bbox: {
    left: number
    top: number
    width: number
    height: number
  }
  averageVisibility: number
  detectionConfidence: number
  detectionSource?: string
}

interface PoseAnalysis {
  poses: PoseResult[]
  averageConfidence: number
  averageVisibility: number
  processingTimeMs: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

// Geometry helpers
interface Point2D {
  x: number
  y: number
  visibility?: number
}

function toCanvasPoint(landmark: NormalizedLandmark, canvasWidth: number, canvasHeight: number): Point2D {
  return { x: clamp(landmark.x * canvasWidth, 0, canvasWidth), y: clamp(landmark.y * canvasHeight, 0, canvasHeight), visibility: landmark.visibility }
}

function distance(a: Point2D, b: Point2D) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}

function midpoint(a: Point2D, b: Point2D) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function lineAngleDegrees(a: Point2D, b: Point2D) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}

function angleBetween3Points(a: Point2D, b: Point2D, c: Point2D) {
  // angle at point b between ba and bc
  const v1x = a.x - b.x
  const v1y = a.y - b.y
  const v2x = c.x - b.x
  const v2y = c.y - b.y

  function angleBetween3Points3D(a: any, b: any, c: any) {
    const v1x = a.x - b.x
    const v1y = a.y - b.y
    const v1z = (a.z ?? 0) - (b.z ?? 0)
    const v2x = c.x - b.x
    const v2y = c.y - b.y
    const v2z = (c.z ?? 0) - (b.z ?? 0)
    const dot = v1x * v2x + v1y * v2y + v1z * v2z
    const mag1 = Math.hypot(v1x, v1y, v1z)
    const mag2 = Math.hypot(v2x, v2y, v2z)
    if (mag1 === 0 || mag2 === 0) return NaN
    const cos = clamp(dot / (mag1 * mag2), -1, 1)
    return (Math.acos(cos) * 180) / Math.PI
  }
  const dot = v1x * v2x + v1y * v2y
  const mag1 = Math.hypot(v1x, v1y)
  const mag2 = Math.hypot(v2x, v2y)
  if (mag1 === 0 || mag2 === 0) return NaN
  const cos = clamp(dot / (mag1 * mag2), -1, 1)
  return (Math.acos(cos) * 180) / Math.PI
}

function angleBetween3Points3D(a: any, b: any, c: any) {
  const v1x = a.x - b.x
  const v1y = a.y - b.y
  const v1z = (a.z ?? 0) - (b.z ?? 0)
  const v2x = c.x - b.x
  const v2y = c.y - b.y
  const v2z = (c.z ?? 0) - (b.z ?? 0)
  const dot = v1x * v2x + v1y * v2y + v1z * v2z
  const mag1 = Math.hypot(v1x, v1y, v1z)
  const mag2 = Math.hypot(v2x, v2y, v2z)
  if (mag1 === 0 || mag2 === 0) return NaN
  const cos = clamp(dot / (mag1 * mag2), -1, 1)
  return (Math.acos(cos) * 180) / Math.PI
}

const VISIBILITY_THRESHOLD = 0.3

function confidenceLabel(conf: number) {
  if (conf >= 0.7) return 'High'
  if (conf >= 0.4) return 'Medium'
  return 'Low'
}

function calculateBiomechanics(pose: PoseResult, canvasWidth: number, canvasHeight: number) {
  // Mediapipe 33-landmark indices (common mapping)
  const LEFT_SHOULDER = 11
  const RIGHT_SHOULDER = 12
  const LEFT_HIP = 23
  const RIGHT_HIP = 24
  const LEFT_KNEE = 25
  const RIGHT_KNEE = 26
  const LEFT_ANKLE = 27
  const RIGHT_ANKLE = 28

  const lm = pose.landmarks

  const getCanvas = (idx: number) => toCanvasPoint(lm[idx], canvasWidth, canvasHeight)
  const getNorm = (idx: number) => ({ x: lm[idx].x, y: lm[idx].y, visibility: lm[idx].visibility })

  // Canvas-space points
  const leftHip = getCanvas(LEFT_HIP)
  const leftKnee = getCanvas(LEFT_KNEE)
  const leftAnkle = getCanvas(LEFT_ANKLE)
  const rightHip = getCanvas(RIGHT_HIP)
  const rightKnee = getCanvas(RIGHT_KNEE)
  const rightAnkle = getCanvas(RIGHT_ANKLE)
  const leftShoulder = getCanvas(LEFT_SHOULDER)
  const rightShoulder = getCanvas(RIGHT_SHOULDER)

  // canvas-space copies for debug
  const leftShoulderC = leftShoulder
  const rightShoulderC = rightShoulder
  const leftHipC = leftHip
  const rightHipC = rightHip
  const leftKneeC = leftKnee
  const rightKneeC = rightKnee
  const leftAnkleC = leftAnkle
  const rightAnkleC = rightAnkle

  // Normalized coords (0..1) for debug
  const leftHipN = getNorm(LEFT_HIP)
  const leftKneeN = getNorm(LEFT_KNEE)
  const leftAnkleN = getNorm(LEFT_ANKLE)
  const rightHipN = getNorm(RIGHT_HIP)
  const rightKneeN = getNorm(RIGHT_KNEE)
  const rightAnkleN = getNorm(RIGHT_ANKLE)
  const leftShoulderN = getNorm(LEFT_SHOULDER)
  const rightShoulderN = getNorm(RIGHT_SHOULDER)

  // confidences per metric (mean visibility of involved landmarks)
  const leftKneeConf = ((leftHipN.visibility ?? 0) + (leftKneeN.visibility ?? 0) + (leftAnkleN.visibility ?? 0)) / 3
  const rightKneeConf = ((rightHipN.visibility ?? 0) + (rightKneeN.visibility ?? 0) + (rightAnkleN.visibility ?? 0)) / 3

  const torsoConf = ((leftShoulderN.visibility ?? 0) + (rightShoulderN.visibility ?? 0) + (leftHipN.visibility ?? 0) + (rightHipN.visibility ?? 0)) / 4

  // Image-space Euclidean distances (normalized coords 0..1)
  const ankleDistance2D = Math.hypot(leftAnkleN.x - rightAnkleN.x, leftAnkleN.y - rightAnkleN.y)
  const shoulderDistance2D = Math.hypot(leftShoulderN.x - rightShoulderN.x, leftShoulderN.y - rightShoulderN.y)
  const rawStanceRatio = shoulderDistance2D > 0 ? ankleDistance2D / shoulderDistance2D : NaN
  const stanceConf = ((leftAnkleN.visibility ?? 0) + (rightAnkleN.visibility ?? 0) + (leftShoulderN.visibility ?? 0) + (rightShoulderN.visibility ?? 0)) / 4

  // Experimental: 3D world landmarks (if available) — compute 3D distances
  let worldAnkleDistance = NaN
  let worldShoulderDistance = NaN
  let worldStanceRatio = NaN
  if (pose.worldLandmarks && pose.worldLandmarks.length > 0) {
    const wl = pose.worldLandmarks
    const lAnk = wl[LEFT_ANKLE]
    const rAnk = wl[RIGHT_ANKLE]
    const lSh = wl[LEFT_SHOULDER]
    const rSh = wl[RIGHT_SHOULDER]
    if (lAnk && rAnk && lSh && rSh) {
      const wAnkDx = lAnk.x - rAnk.x
      const wAnkDy = lAnk.y - rAnk.y
      const wAnkDz = (lAnk.z ?? 0) - (rAnk.z ?? 0)
      worldAnkleDistance = Math.hypot(wAnkDx, wAnkDy, wAnkDz)
      const wShDx = lSh.x - rSh.x
      const wShDy = lSh.y - rSh.y
      const wShDz = (lSh.z ?? 0) - (rSh.z ?? 0)
      worldShoulderDistance = Math.hypot(wShDx, wShDy, wShDz)
      worldStanceRatio = worldShoulderDistance > 0 ? worldAnkleDistance / worldShoulderDistance : NaN
    }
  }

  const shoulderTiltConf = ((leftShoulderN.visibility ?? 0) + (rightShoulderN.visibility ?? 0)) / 2

  // Knee joint angle (hip -> knee -> ankle) — anatomical joint angle where
  // straight leg ≈ 180°. Expose both joint angle and flexion (180 - angle).
  const leftKneeAngle = angleBetween3Points(leftHip, leftKnee, leftAnkle)
  const rightKneeAngle = angleBetween3Points(rightHip, rightKnee, rightAnkle)
  const leftKneeFlexion = Number.isNaN(leftKneeAngle) ? NaN : 180 - leftKneeAngle
  const rightKneeFlexion = Number.isNaN(rightKneeAngle) ? NaN : 180 - rightKneeAngle

  // Torso lean: use mid-shoulder -> mid-hip vector relative to image vertical.
  // This is a 2D camera-relative estimate (not true 3D trunk flexion).
  const shoulderMid = midpoint(leftShoulder, rightShoulder)
  const hipMid = midpoint(leftHip, rightHip)
  const hipDistance2D = Math.hypot(leftHipN.x - rightHipN.x, leftHipN.y - rightHipN.y)
  // Use aspect-corrected image distances for orientation geometry. Dividing all
  // lengths by image height removes scale without distorting x relative to y.
  const shoulderSpanGeometry = Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y) / canvasHeight
  const hipSpanGeometry = Math.hypot(leftHip.x - rightHip.x, leftHip.y - rightHip.y) / canvasHeight
  const torsoLength2D = Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y) / canvasHeight
  const torsoLineAngle = lineAngleDegrees(hipMid, shoulderMid) // degrees from +x axis
  // Angle relative to vertical (-90..90)
  const torsoLeanRaw = torsoLineAngle
  const torsoLean = Math.abs(90 - Math.abs(torsoLineAngle))
  // Experimental world-space torso lean if worldLandmarks exist (3D)
  // We compute both the raw geometric angle between the torso vector (midHip->midShoulder)
  // and the world vertical (0,1,0), and a normalized "smallest deviation" in [0,90].
  let worldTorsoLeanRaw = NaN
  let worldTorsoLean = NaN // normalized smallest meaningful deviation (0..90)
  if (pose.worldLandmarks && pose.worldLandmarks.length > 0) {
    const wl = pose.worldLandmarks
    const lSh = wl[LEFT_SHOULDER]
    const rSh = wl[RIGHT_SHOULDER]
    const lHi = wl[LEFT_HIP]
    const rHi = wl[RIGHT_HIP]
    if (lSh && rSh && lHi && rHi) {
      const sMid = { x: (lSh.x + rSh.x) / 2, y: (lSh.y + rSh.y) / 2, z: (lSh.z + rSh.z) / 2 }
      const hMid = { x: (lHi.x + rHi.x) / 2, y: (lHi.y + rHi.y) / 2, z: (lHi.z + rHi.z) / 2 }
      const vx = sMid.x - hMid.x
      const vy = sMid.y - hMid.y
      const vz = sMid.z - hMid.z
      const mag = Math.hypot(vx, vy, vz)
      if (mag > 0) {
        // raw angle between torso vector and world vertical (0,1,0)
        const dot = vy // vertical unit vector is (0,1,0)
        const cos = clamp(dot / mag, -1, 1)
        worldTorsoLeanRaw = (Math.acos(cos) * 180) / Math.PI
        // normalized smallest meaningful deviation from upright is the acute angle:
        // smallestAngle = min(rawAngle, 180 - rawAngle), which maps to [0,90]
        const smallest = Math.min(worldTorsoLeanRaw, 180 - worldTorsoLeanRaw)
        // sanity: ensure within [0,90]
        worldTorsoLean = Number.isFinite(smallest) && !Number.isNaN(smallest) ? clamp(smallest, 0, 90) : NaN
      }
    }
  }

  // Shoulder tilt: signed angle of left->right shoulder relative to horizontal.
  // Normalize to -90..+90 degrees so negative = left shoulder lower, positive = right shoulder lower.
  const rawShoulderAngle = lineAngleDegrees(leftShoulder, rightShoulder)
  let shoulderTilt = rawShoulderAngle
  if (shoulderTilt > 90) shoulderTilt -= 180
  if (shoulderTilt < -90) shoulderTilt += 180

  // Camera/body-orientation diagnostics. Span-to-torso ratios are scale-normalized
  // proxies for foreshortening; shoulder/hip agreement catches unstable silhouettes.
  // They cannot recover true 3D yaw, so thresholds remain conservative heuristics.
  const shoulderSpanToTorso = torsoLength2D > 0 ? shoulderSpanGeometry / torsoLength2D : NaN
  const hipSpanToTorso = torsoLength2D > 0 ? hipSpanGeometry / torsoLength2D : NaN
  const shoulderToHipSpanRatio = hipSpanGeometry > 0 ? shoulderSpanGeometry / hipSpanGeometry : NaN
  const hipLineAngle = lineAngleDegrees(leftHip, rightHip)
  const normalizeAxisAngle = (angle: number) => {
    let normalized = angle
    while (normalized > 90) normalized -= 180
    while (normalized < -90) normalized += 180
    return normalized
  }
  const shoulderHipAxisDifference = Math.abs(normalizeAxisAngle(rawShoulderAngle - hipLineAngle))
  const orientationReasons: string[] = []
  if (!Number.isFinite(torsoLength2D) || torsoLength2D < 0.03) orientationReasons.push('Torso reference length is too small for stable normalization.')
  if (!Number.isFinite(shoulderSpanToTorso) || shoulderSpanToTorso < 0.35) orientationReasons.push('Projected shoulder span is severely foreshortened.')
  if (!Number.isFinite(hipSpanToTorso) || hipSpanToTorso < 0.2) orientationReasons.push('Projected hip span is severely foreshortened.')
  if (!Number.isFinite(shoulderToHipSpanRatio) || shoulderToHipSpanRatio < 0.65 || shoulderToHipSpanRatio > 2.25) orientationReasons.push('Shoulder and hip spans are geometrically inconsistent.')
  if (!Number.isFinite(shoulderHipAxisDifference) || shoulderHipAxisDifference > 35) orientationReasons.push('Shoulder and hip axes disagree strongly in the image.')
  const orientationCautions: string[] = []
  if (shoulderSpanToTorso < 0.5) orientationCautions.push('Possible shoulder foreshortening.')
  if (hipSpanToTorso < 0.3) orientationCautions.push('Possible hip foreshortening.')
  if (shoulderHipAxisDifference > 20) orientationCautions.push('Shoulder/hip axis alignment is marginal.')
  const orientationReliability = torsoConf < 0.4 || orientationReasons.length > 0
    ? 'Low'
    : torsoConf < 0.7 || orientationCautions.length > 0
      ? 'Medium'
      : 'High'
  const stanceDenominatorStable = Number.isFinite(shoulderSpanToTorso) && shoulderSpanToTorso >= 0.5 && shoulderDistance2D >= 0.025
  const orientationSignature = { shoulderSpanToTorso, hipSpanToTorso, shoulderToHipSpanRatio, shoulderHipAxisDifference }

  return {
    // angles
    leftKneeAngle,
    leftKneeFlexion,
    rightKneeAngle,
    rightKneeFlexion,
    torsoLean,
    torsoLeanRaw,
    worldTorsoLeanRaw,
    worldTorsoLean,
    rawShoulderAngle,
    shoulderTilt,
    // normalized distances
    ankleDistNorm: Math.hypot(leftAnkleN.x - rightAnkleN.x, leftAnkleN.y - rightAnkleN.y),
    shoulderDistNorm: Math.hypot(leftShoulderN.x - rightShoulderN.x, leftShoulderN.y - rightShoulderN.y),
    rawStanceRatio,
    worldAnkleDistance,
    worldShoulderDistance,
    worldStanceRatio,
    // confidences (numeric)
    leftKneeConf,
    rightKneeConf,
    torsoConf,
    stanceConf,
    shoulderTiltConf,
    // boolean vis checks
    leftKneeVisible: leftKneeConf >= VISIBILITY_THRESHOLD,
    rightKneeVisible: rightKneeConf >= VISIBILITY_THRESHOLD,
    torsoVisible: torsoConf >= VISIBILITY_THRESHOLD,
    stanceVisible: stanceConf >= VISIBILITY_THRESHOLD && !Number.isNaN(rawStanceRatio),
    shoulderTiltVisible: shoulderTiltConf >= VISIBILITY_THRESHOLD,
    // raw normalized points for debug
    raw: {
      leftShoulder: leftShoulderN,
      rightShoulder: rightShoulderN,
      leftHip: leftHipN,
      rightHip: rightHipN,
      leftKnee: leftKneeN,
      rightKnee: rightKneeN,
      leftAnkle: leftAnkleN,
      rightAnkle: rightAnkleN,
    },
    // raw canvas-space points for easier debugging (pixels)
    rawCanvas: {
      leftShoulder: { x: leftShoulderC.x, y: leftShoulderC.y, visibility: leftShoulderN.visibility },
      rightShoulder: { x: rightShoulderC.x, y: rightShoulderC.y, visibility: rightShoulderN.visibility },
      leftHip: { x: leftHipC.x, y: leftHipC.y, visibility: leftHipN.visibility },
      rightHip: { x: rightHipC.x, y: rightHipC.y, visibility: rightHipN.visibility },
      leftKnee: { x: leftKneeC.x, y: leftKneeC.y, visibility: leftKneeN.visibility },
      rightKnee: { x: rightKneeC.x, y: rightKneeC.y, visibility: rightKneeN.visibility },
      leftAnkle: { x: leftAnkleC.x, y: leftAnkleC.y, visibility: leftAnkleN.visibility },
      rightAnkle: { x: rightAnkleC.x, y: rightAnkleC.y, visibility: rightAnkleN.visibility },
    },
    orientationReliability,
    orientationReasons,
    orientationCautions,
    orientationSignature,
    stanceDenominatorStable,
    hipDistNorm: hipDistance2D,
    torsoLengthNorm: torsoLength2D,
  }
}

export default function PoseTestPage() {
  type Phase = 'ready' | 'contact' | 'recovery'
  const phases: Phase[] = ['ready', 'contact', 'recovery']

  const [files, setFiles] = useState<Record<Phase, File | null>>({ ready: null, contact: null, recovery: null })
  const [previews, setPreviews] = useState<Record<Phase, string | null>>({ ready: null, contact: null, recovery: null })
  const [canvasSizes, setCanvasSizes] = useState<Record<Phase, { width: number; height: number }>>({ ready: { width: 960, height: 540 }, contact: { width: 960, height: 540 }, recovery: { width: 960, height: 540 } })
  const [loading, setLoading] = useState<Record<Phase, boolean>>({ ready: false, contact: false, recovery: false })
  const [analyses, setAnalyses] = useState<Record<Phase, PoseAnalysis | null>>({ ready: null, contact: null, recovery: null })
  const [selectedPoseIndex, setSelectedPoseIndex] = useState<Record<Phase, number | null>>({ ready: null, contact: null, recovery: null })
  const [error, setError] = useState<Record<Phase, string | null>>({ ready: null, contact: null, recovery: null })

  // Video-to-frames state (Sprint 3.0)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoMeta, setVideoMeta] = useState<{ duration: number; width: number; height: number } | null>(null)
  const [frames, setFrames] = useState<Array<{ frameId: string; timestampSeconds: number; imageDataUrl: string }>>([])
  const [extracting, setExtracting] = useState(false)
  const [selectedPhaseToAssign, setSelectedPhaseToAssign] = useState<Phase>('ready')
  const [selectedFrameByPhase, setSelectedFrameByPhase] = useState<Record<Phase, string | null>>({ ready: null, contact: null, recovery: null })
  const [processingStatus, setProcessingStatus] = useState<string | null>(null)
  const [lastFrameMeta, setLastFrameMeta] = useState<Record<Phase, { timestampSeconds: number; width: number; height: number } | null>>({ ready: null, contact: null, recovery: null })

  // Persistent targeting state
  const [persistentAnchor, setPersistentAnchor] = useState<null | { id: string; features: any }>(null)
  const [persistentAssignment, setPersistentAssignment] = useState<Record<Phase, { persistentPlayerId?: string; poseIndex?: number; score?: number; manual?: boolean }>>({ ready: {}, contact: {}, recovery: {} } as any)
  const [matchCandidates, setMatchCandidates] = useState<Record<Phase, Array<any>>>({ ready: [], contact: [], recovery: [] } as any)
  const [autoResult, setAutoResult] = useState<PhaseResult | null>(null)
  const [refinement, setRefinement] = useState<RefinementResult | null>(null)
  const [localEvidence, setLocalEvidence] = useState<Array<{ phase: Phase; timestamp: number; extracted: boolean; poses: number; sources: string; poseIndex: number | null; score: number; second: number | null; rejection: string | null; geometry: boolean }>>([])
  const [refinedFrames, setRefinedFrames] = useState<Array<{ frameId: string; timestampSeconds: number; imageDataUrl: string }>>([])
  const phaseFrames = [...frames, ...refinedFrames]
  const displayProposals = refinement?.proposals ?? autoResult?.proposals ?? []
  const [autoBusy, setAutoBusy] = useState(false)
  const [paddleHand, setPaddleHand] = useState<'left' | 'right'>('right')
  const [selectionOrigin, setSelectionOrigin] = useState<Record<Phase, string>>({ ready: 'MANUAL', contact: 'MANUAL', recovery: 'MANUAL' })
  const autoCache = useRef(new Map<string, { image: HTMLImageElement; poses: PoseResult[]; poseIndex: number | null; score: number }>())

  const imageRefs = useRef<Record<Phase, HTMLImageElement | null>>({} as any)
  const canvasRefs = useRef<Record<Phase, HTMLCanvasElement | null>>({} as any)
  const poseLandmarkerRef = useRef<any>(null)
  const sourceGeneration = useRef(0)
  const [phaseVideoFingerprint, setPhaseVideoFingerprint] = useState<Record<Phase, string | null>>({ ready: null, contact: null, recovery: null })

  const resetVideoAnalysis = () => {
    setRefinedFrames([])
    setAutoResult(null); setRefinement(null); setLocalEvidence([])
    setAutoBusy(false)
    autoCache.current.clear()
    setSelectionOrigin({ ready: 'MANUAL', contact: 'MANUAL', recovery: 'MANUAL' })
    clearStoredVideoBiomechanics(() => window.localStorage, videoFile ? videoFingerprint(videoFile) : null)
    sourceGeneration.current += 1
    setAnalyses({ ready: null, contact: null, recovery: null })
    setSelectedPoseIndex({ ready: null, contact: null, recovery: null })
    setSelectedFrameByPhase({ ready: null, contact: null, recovery: null })
    setPhaseVideoFingerprint({ ready: null, contact: null, recovery: null })
    setLastFrameMeta({ ready: null, contact: null, recovery: null })
    setPersistentAnchor(null)
    setPersistentAssignment({ ready: {}, contact: {}, recovery: {} })
    setMatchCandidates({ ready: [], contact: [], recovery: [] })
    setLoading({ ready: false, contact: false, recovery: false })
    setError({ ready: null, contact: null, recovery: null })
    setExtracting(false)
    setFiles({ ready: null, contact: null, recovery: null })
    setPreviews({ ready: null, contact: null, recovery: null })
    imageRefs.current = { ready: null, contact: null, recovery: null }
    Object.values(canvasRefs.current).forEach((canvas) => canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height))
    setProcessingStatus(null)
  }

  useEffect(() => {
    // revoke previews when files change or component unmounts
    return () => {
      Object.values(previews).forEach((url) => {
        if (url) URL.revokeObjectURL(url)
      })
    }
  }, [previews])

  useEffect(() => {
    return () => {
      if (poseLandmarkerRef.current?.close) {
        poseLandmarkerRef.current.close()
      }
    }
  }, [])

  const handleFileChange = (phase: Phase) => (event: ChangeEvent<HTMLInputElement>) => {
    setAutoResult(null); setRefinement(null); setLocalEvidence([])
    autoCache.current.clear()
    sourceGeneration.current += 1
    setPhaseVideoFingerprint((s) => ({ ...s, [phase]: null }))
    setAnalyses((a) => ({ ...a, [phase]: null }))
    const file = event.target.files?.[0] ?? null
    setFiles((s) => ({ ...s, [phase]: file }))
    if (file) {
      const url = URL.createObjectURL(file)
      setPreviews((p) => ({ ...p, [phase]: url }))
      setAnalyses((a) => ({ ...a, [phase]: null }))
      setSelectedPoseIndex((s) => ({ ...s, [phase]: null }))
      setError((e) => ({ ...e, [phase]: null }))
    } else {
      setPreviews((p) => ({ ...p, [phase]: null }))
    }
  }

  // Video handlers
  const handleVideoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    resetVideoAnalysis()
    setVideoFile(file)
    if (file) {
      const url = URL.createObjectURL(file)
      setVideoUrl(url)
      setFrames([])
      setVideoMeta(null)
    } else {
      setVideoUrl(null)
      setFrames([])
      setVideoMeta(null)
    }
  }

  const extractCandidateFrames = async () => {
    if (!videoUrl) return
    const generation = sourceGeneration.current
    setExtracting(true)
    setProcessingStatus('Extracting candidate frames...')
    try {
      const video = document.createElement('video')
      video.src = videoUrl
      video.crossOrigin = 'anonymous'
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('Video load timeout')), 5000)
        video.addEventListener('loadedmetadata', () => {
          clearTimeout(t)
          res(null)
        })
      })
      const duration = video.duration || 0
      const vidW = video.videoWidth || 640
      const vidH = video.videoHeight || 360
      if (generation !== sourceGeneration.current) return
      setVideoMeta({ duration, width: vidW, height: vidH })

      // sample target frames ~20-30 depending on duration
      const target = Math.min(30, Math.max(8, Math.round(duration * 3)))
      const sampleCount = Math.max(4, target)
      const timestamps: number[] = []
      for (let i = 0; i < sampleCount; i++) {
        timestamps.push((i + 0.5) * (duration / sampleCount))
      }

      const off = document.createElement('canvas')
      const ctx = off.getContext('2d')
      // Preserve as much resolution as practical for detection. Cap width to 1280px.
      const maxW = Math.min(1280, vidW)
      const scale = Math.min(1, maxW / vidW)
      off.width = Math.max(1, Math.round(vidW * scale))
      off.height = Math.max(1, Math.round(vidH * scale))

      const extracted: Array<{ frameId: string; timestampSeconds: number; imageDataUrl: string }> = []
      for (let t of timestamps) {
        await new Promise((res) => {
          const onseek = () => {
            try {
              ctx && ctx.drawImage(video, 0, 0, off.width, off.height)
              const data = off.toDataURL('image/jpeg', 0.92)
              extracted.push({ frameId: `f-${Math.round(t * 1000)}`, timestampSeconds: t, imageDataUrl: data })
            } catch (e) {
              // skip
            }
            res(null)
          }
          video.currentTime = Math.min(Math.max(0.001, t), duration - 0.001)
          video.addEventListener('seeked', onseek, { once: true })
        })
      }
      if (generation !== sourceGeneration.current) return
      setFrames(extracted)
      setProcessingStatus('Frames ready')
    } catch (err) {
      if (generation !== sourceGeneration.current) return
      console.error(err)
      setProcessingStatus('Frame extraction failed')
    } finally {
      if (generation === sourceGeneration.current) setExtracting(false)
    }
  }

  const assignFrameToPhase = (phase: Phase, frameId: string) => {
    if (autoBusy) return
    sourceGeneration.current += 1
    setLoading({ ready: false, contact: false, recovery: false })
    setSelectedFrameByPhase((s) => overridePhase(s, phase, frameId))
    setSelectionOrigin((s) => overridePhase(s, phase, 'MANUAL OVERRIDE'))
    setAnalyses((s) => ({ ...s, [phase]: null }))
    setSelectedPoseIndex((s) => ({ ...s, [phase]: null }))
    setLastFrameMeta((s) => ({ ...s, [phase]: null }))
    imageRefs.current[phase] = null
    const canvas = canvasRefs.current[phase]
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  }

  // Analyze only Ready first so the developer can manually select TARGET_A.
  const analyzeSelectedFrames = async () => {
    const generation = sourceGeneration.current
    setProcessingStatus('Analyzing Ready pose...')
    const phase: Phase = 'ready'
    const fid = selectedFrameByPhase[phase]
    if (!fid) {
      setProcessingStatus('Ready frame not assigned')
      return
    }
    const frame = phaseFrames.find((f) => f.frameId === fid)
    if (!frame) {
      setProcessingStatus('Ready frame not found')
      return
    }
    const img = new Image()
    img.src = frame.imageDataUrl
    await new Promise((res) => (img.onload = () => res(null)))
    if (generation !== sourceGeneration.current) return
    setPhaseVideoFingerprint((s) => ({ ...s, [phase]: videoFile ? videoFingerprint(videoFile) : null }))
    imageRefs.current[phase] = img
    setCanvasSizes((s) => ({ ...s, [phase]: { width: img.naturalWidth, height: img.naturalHeight } }))
    setLastFrameMeta((m) => ({ ...m, [phase]: { timestampSeconds: frame.timestampSeconds, width: img.naturalWidth, height: img.naturalHeight } }))
    await handleDetectPose(phase)()
    setProcessingStatus('Ready analyzed — please click the Ready canvas to select TARGET_A')
  }

  // After developer selects TARGET_A (manual), call this to analyze contact & recovery and auto-match
  const analyzeRemainingAfterAnchor = async () => {
    const generation = sourceGeneration.current
    if (!persistentAnchor) {
      setProcessingStatus('No anchor set. Select TARGET_A in Ready canvas first.')
      return
    }
    setProcessingStatus('Analyzing Contact and Recovery...')
    for (const phase of ['contact', 'recovery'] as Phase[]) {
      const fid = selectedFrameByPhase[phase]
      if (!fid) continue
      const frame = phaseFrames.find((f) => f.frameId === fid)
      if (!frame) continue
      const img = new Image()
      img.src = frame.imageDataUrl
      await new Promise((res) => (img.onload = () => res(null)))
      if (generation !== sourceGeneration.current) return
      setPhaseVideoFingerprint((s) => ({ ...s, [phase]: videoFile ? videoFingerprint(videoFile) : null }))
      imageRefs.current[phase] = img
      setCanvasSizes((s) => ({ ...s, [phase]: { width: img.naturalWidth, height: img.naturalHeight } }))
      setLastFrameMeta((m) => ({ ...m, [phase]: { timestampSeconds: frame.timestampSeconds, width: img.naturalWidth, height: img.naturalHeight } }))
      await handleDetectPose(phase)()
      if (generation !== sourceGeneration.current) return
    }
    setProcessingStatus('Analyzing poses complete')
  }

  const drawImageFor = (canvas: HTMLCanvasElement | null, image: HTMLImageElement | null, size: { width: number; height: number } | null) => {
    if (!canvas || !image || !size) return
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.save()
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#020617'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    ctx.restore()
  }

  const resizeCanvasToImage = (phase: Phase) => {
    const image = imageRefs.current[phase]
    if (!image) return
    const maxWidth = 960
    const maxHeight = 720
    const naturalWidth = image.naturalWidth
    const naturalHeight = image.naturalHeight
    const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1)
    const width = Math.round(naturalWidth * scale)
    const height = Math.round(naturalHeight * scale)
    setCanvasSizes((s) => ({ ...s, [phase]: { width, height } }))
  }

  const getPoseLandmarker = async () => {
    if (poseLandmarkerRef.current) {
      return poseLandmarkerRef.current
    }

    const vision = await import('@mediapipe/tasks-vision')
    const wasmFileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE_URL)
    const landmarker = await vision.PoseLandmarker.createFromOptions(wasmFileset, {
      baseOptions: { modelAssetPath: MODEL_URL },
      runningMode: 'IMAGE',
      numPoses: 4,
      minPoseDetectionConfidence: 0.3,
      minPosePresenceConfidence: 0.2,
      minTrackingConfidence: 0.2,
      outputSegmentationMasks: false,
    })

    poseLandmarkerRef.current = landmarker
    return landmarker
  }

  // Run PoseLandmarker on an image (HTMLImageElement or HTMLCanvasElement)
  // and return the raw result object with landmarks and worldLandmarks.
  const runLandmarker = async (input: any) => {
    const landmarker = await getPoseLandmarker()
    const start = performance.now()
    const result = landmarker.detect(input) as any
    const duration = Math.round(performance.now() - start)
    return { result, duration }
  }

  // IOU for bbox deduplication (boxes in pixels)
  const iou = (a: any, b: any) => {
    const x1 = Math.max(a.left, b.left)
    const y1 = Math.max(a.top, b.top)
    const x2 = Math.min(a.left + a.width, b.left + b.width)
    const y2 = Math.min(a.top + a.height, b.top + b.height)
    const w = Math.max(0, x2 - x1)
    const h = Math.max(0, y2 - y1)
    const inter = w * h
    const union = a.width * a.height + b.width * b.height - inter
    return union <= 0 ? 0 : inter / union
  }

  // Multi-pass detection: full frame, then optional left/right crops.
  const detectMultiPass = async (image: HTMLImageElement, fullSize: { width: number; height: number }) => {
    const posesOut: any[] = []

    // PASS A: full frame
    const full = await runLandmarker(image)
    const fullRes = full.result
    const fullWorld = fullRes.worldLandmarks ?? []
    const fullLandmarks = fullRes.landmarks ?? []
    if (fullLandmarks && fullLandmarks.length > 0) {
      for (let i = 0; i < fullLandmarks.length; i++) {
        const lms = fullLandmarks[i]
        const world = fullWorld[i] ?? null
        posesOut.push({ landmarks: lms, worldLandmarks: world, detectionSource: 'FULL_FRAME' })
      }
    }

    // If less than 2 poses, run crop passes
    if (posesOut.length < 2) {
      const overlap = 0.15
      const w = fullSize.width
      const h = fullSize.height
      const half = Math.floor(w / 2)
      const leftX = 0
      const leftW = Math.floor(half + overlap * half)
      const rightX = Math.floor(half - overlap * half)
      const rightW = Math.floor(w - rightX)

      const runCrop = async (sx: number, sw: number, label: string) => {
        const cvs = document.createElement('canvas')
        cvs.width = sw
        cvs.height = h
        const ctx = cvs.getContext('2d')
        if (!ctx) return
        ctx.drawImage(image, sx, 0, sw, h, 0, 0, sw, h)
        const img = new Image()
        img.src = cvs.toDataURL('image/jpeg', 0.92)
        await new Promise((res) => (img.onload = () => res(null)))
        const resCrop = await runLandmarker(img)
        const r = resCrop.result
        const lm = r.landmarks ?? []
        const wl = r.worldLandmarks ?? []
        for (let i = 0; i < lm.length; i++) {
          // map landmark x,y back to full-frame normalized coords
          const lset = lm[i].map((pt: any) => ({ x: (pt.x * sw + sx) / w, y: (pt.y * h) / h, visibility: pt.visibility }))
          const world = wl[i] ?? null
          posesOut.push({ landmarks: lset, worldLandmarks: world, detectionSource: label })
        }
      }

      await runCrop(leftX, leftW, 'LEFT_CROP')
      await runCrop(rightX, rightW, 'RIGHT_CROP')
    }

    // Build PoseResult-like objects with bbox and confidence
    const poseResults: PoseResult[] = []
    for (let pi = 0; pi < posesOut.length; pi++) {
      const plm = posesOut[pi].landmarks
      const normXs = plm.map((lm: any) => lm.x)
      const normYs = plm.map((lm: any) => lm.y)
      const left = Math.min(...normXs) * fullSize.width
      const top = Math.min(...normYs) * fullSize.height
      const right = Math.max(...normXs) * fullSize.width
      const bottom = Math.max(...normYs) * fullSize.height
      const averageVisibility = calculateAverage(plm.map((l: any) => l.visibility ?? 0))
      const detectionConfidence = averageVisibility
      poseResults.push({
        poseIndex: pi + 1,
        landmarks: plm,
        worldLandmarks: posesOut[pi].worldLandmarks ?? null,
        bbox: { left: clamp(left, 0, fullSize.width), top: clamp(top, 0, fullSize.height), width: clamp(right - left, 0, fullSize.width), height: clamp(bottom - top, 0, fullSize.height) },
        averageVisibility,
        detectionConfidence,
        detectionSource: posesOut[pi].detectionSource,
      } as any)
    }

    // Deduplicate by IoU (keep higher-confidence)
    poseResults.sort((a, b) => (b.detectionConfidence ?? 0) - (a.detectionConfidence ?? 0))
    const deduped: PoseResult[] = []
    for (const p of poseResults) {
      let dup = false
      for (const kept of deduped) {
        if (iou(p.bbox, kept.bbox) > 0.5) {
          dup = true
          break
        }
      }
      if (!dup) deduped.push(p)
    }

    return deduped
  }

  const calculateAverage = (values: number[]) => {
    if (values.length === 0) return 0
    return values.reduce((sum, value) => sum + value, 0) / values.length
  }

  const drawResults = (poses: PoseResult[], canvas: HTMLCanvasElement | null, image: HTMLImageElement | null, size: { width: number; height: number } | null, selectedIndex: number | null = null) => {
    if (!canvas || !image || !size) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    drawImageFor(canvas, image, size)
    ctx.save()
    ctx.font = 'bold 12px ui-sans-serif'
    ctx.textBaseline = 'top'

    poses.forEach((pose) => {
      const isSelected = selectedIndex === pose.poseIndex
      const { landmarks, bbox } = pose

      // non-selected reduced opacity
      ctx.globalAlpha = isSelected ? 1 : 0.35

      // bounding box
      ctx.strokeStyle = isSelected ? '#00ff66' : '#4ade80'
      ctx.lineWidth = isSelected ? 4 : 2
      ctx.strokeRect(bbox.left, bbox.top, bbox.width, bbox.height)

      // landmarks
      ctx.fillStyle = isSelected ? '#00ff66' : '#4ade80'
      landmarks.forEach((landmark, index) => {
        const x = clamp(landmark.x * canvas.width, 0, canvas.width)
        const y = clamp(landmark.y * canvas.height, 0, canvas.height)
        ctx.beginPath()
        ctx.arc(x, y, isSelected ? 6 : 4, 0, Math.PI * 2)
        ctx.fill()
        if (isSelected) {
          ctx.fillText(index.toString(), x + 6, y - 6)
        }
      })

      // skeleton connections
      const connections = (poseLandmarkerRef.current?.constructor?.POSE_CONNECTIONS ?? []) as Array<{ start: number; end: number }>
      ctx.lineWidth = isSelected ? 3 : 2
      connections.forEach((connection) => {
        const start = landmarks[connection.start]
        const end = landmarks[connection.end]
        if (!start || !end) return

        const startX = clamp(start.x * canvas.width, 0, canvas.width)
        const startY = clamp(start.y * canvas.height, 0, canvas.height)
        const endX = clamp(end.x * canvas.width, 0, canvas.width)
        const endY = clamp(end.y * canvas.height, 0, canvas.height)

        ctx.beginPath()
        ctx.moveTo(startX, startY)
        ctx.lineTo(endX, endY)
        ctx.stroke()
      })

      // reset alpha for next pose
      ctx.globalAlpha = 1
    })

    ctx.restore()
  }

  // Extract simple features from a pose result for matching
  const extractFeatures = (pose: PoseResult, size: { width: number; height: number }) => {
    const centerX = pose.bbox.left + pose.bbox.width / 2
    const centerY = pose.bbox.top + pose.bbox.height / 2
    const normCenterX = centerX / size.width
    const normCenterY = centerY / size.height
    const normWidth = pose.bbox.width / size.width
    const normHeight = pose.bbox.height / size.height
    const area = normWidth * normHeight
    const landmarks = pose.landmarks.map((lm) => ({ x: lm.x, y: lm.y, visibility: lm.visibility ?? 0 }))
    const avgVis = calculateAverage(landmarks.map((l) => l.visibility ?? 0))
    return { center: { x: normCenterX, y: normCenterY }, normWidth, normHeight, area, landmarks, confidence: avgVis }
  }

  const runAutomaticPhases = async () => {
    if (!persistentAnchor || autoBusy) return
    const generation = ++sourceGeneration.current
    setAutoBusy(true)
    setAutoResult(null); setRefinement(null); setLocalEvidence([])
    autoCache.current.clear()
    const candidates: PhaseCandidate[] = []
    try {
      for (const [index, frame] of frames.entries()) {
        if (generation !== sourceGeneration.current) return
        setProcessingStatus(`Matching TARGET_A: ${index + 1}/${frames.length}`)
        const image = new Image()
        image.src = frame.imageDataUrl
        await image.decode()
        const size = { width: image.naturalWidth, height: image.naturalHeight }
        const poses = await detectMultiPass(image, size)
        if (generation !== sourceGeneration.current) return
        const match = matchPhaseTarget(persistentAnchor.features, poses.map((pose) => ({ poseIndex: pose.poseIndex, features: extractFeatures(pose, size) })))
        const target = poses.find((p) => p.poseIndex === match.poseIndex)
        autoCache.current.set(frame.frameId, { image, poses, poseIndex: match.poseIndex, score: match.score })
        candidates.push({ frameId: frame.frameId, timestamp: frame.timestampSeconds, targetScore: match.score, matched: match.reliable,
          ...(target ? phaseGeometry(target.landmarks, size.width / size.height, paddleHand) : { reach: null, wrist: null }) })
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      if (generation !== sourceGeneration.current) return
      setAutoResult(detectPhases(candidates))
      setProcessingStatus('Automatic proposals ready for visual review')
    } catch {
      if (generation === sourceGeneration.current) setProcessingStatus('Automatic detection failed. Manual selection remains available.')
    } finally {
      if (generation === sourceGeneration.current) setAutoBusy(false)
    }
  }

  const runLocalRefinement = async () => {
    if (!autoResult || !persistentAnchor || !videoUrl || !videoMeta || autoBusy) return
    const plan = planPhaseRefinement(autoResult.proposals, videoMeta.duration)
    if (!plan.windows.length) return
    const generation = ++sourceGeneration.current
    setAutoBusy(true)
    setRefinement(null)
    const video = document.createElement('video')
    const localFrames: typeof refinedFrames = []
    const localCandidates: PhaseCandidate[] = []
    const evidence: typeof localEvidence = plan.windows.flatMap((w) => w.timestamps.map((timestamp) => ({ phase: w.phase, timestamp, extracted: false, poses: 0, sources: '', poseIndex: null, score: 0, second: null, rejection: 'pending / not extracted', geometry: false })))
    setLocalEvidence(evidence)
    const recordEvidence = (timestamp: number, frameId: string, candidate?: PhaseCandidate) => {
      const entry = autoCache.current.get(frameId)
      const size = entry ? { width: entry.image.naturalWidth, height: entry.image.naturalHeight } : null
      const match = matchPhaseTarget(persistentAnchor.features, entry && size ? entry.poses.map((pose) => ({ poseIndex: pose.poseIndex, features: extractFeatures(pose, size) })) : [])
      evidence[evidence.findIndex((e) => e.timestamp === timestamp)] = { phase: plan.windows.find((w) => w.timestamps.includes(timestamp))!.phase, timestamp, extracted: !!entry,
        poses: entry?.poses.length ?? 0, sources: entry?.poses.map((p) => p.detectionSource).join(', ') ?? '', poseIndex: match.poseIndex,
        score: match.score, second: match.secondScore, rejection: match.rejection, geometry: candidate?.wrist != null }
      setLocalEvidence([...evidence])
    }
    // Waits clean up their handlers on success/error/timeout; no unbounded seeks.
    const waitVideo = (event: 'loadeddata' | 'seeked', action: () => void) => new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener('error', failed) }
      const done = () => { cleanup(); resolve() }
      const failed = () => { cleanup(); reject(new Error('Local video extraction failed')) }
      const timer = setTimeout(failed, 8000)
      video.addEventListener(event, done, { once: true })
      video.addEventListener('error', failed, { once: true })
      action()
    })
    try {
      await waitVideo('loadeddata', () => { video.preload = 'auto'; video.src = videoUrl; video.load() })
      const canvas = document.createElement('canvas')
      const scale = Math.min(1, 1280 / video.videoWidth)
      canvas.width = Math.round(video.videoWidth * scale)
      canvas.height = Math.round(video.videoHeight * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas unavailable')
      const timestamps = plan.windows.flatMap((w) => w.timestamps)
      for (const [i, timestamp] of timestamps.entries()) {
        if (generation !== sourceGeneration.current) return
        setProcessingStatus(`Local refinement: ${i + 1}/${timestamps.length}`)
        const coarseFrame = frames.find((f) => Math.abs(f.timestampSeconds - timestamp) < 0.000001)
        if (coarseFrame) {
          const candidate = autoResult.candidates.find((c) => c.frameId === coarseFrame.frameId)
          if (candidate) localCandidates.push(candidate)
          recordEvidence(timestamp, coarseFrame.frameId, candidate)
          continue
        }
        const seekTime = Math.min(video.duration - 0.001, Math.max(0, timestamp))
        if (Math.abs(video.currentTime - seekTime) > 0.000001) await waitVideo('seeked', () => { video.currentTime = seekTime })
        if (generation !== sourceGeneration.current) return
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const frame = { frameId: `local-${Math.round(timestamp * 1000000)}`, timestampSeconds: timestamp, imageDataUrl: canvas.toDataURL('image/jpeg', 0.92) }
        const image = new Image()
        image.src = frame.imageDataUrl
        await image.decode()
        const size = { width: image.naturalWidth, height: image.naturalHeight }
        const poses = await detectMultiPass(image, size)
        if (generation !== sourceGeneration.current) return
        const match = matchPhaseTarget(persistentAnchor.features, poses.map((pose) => ({ poseIndex: pose.poseIndex, features: extractFeatures(pose, size) })))
        const target = poses.find((p) => p.poseIndex === match.poseIndex)
        autoCache.current.set(frame.frameId, { image, poses, poseIndex: match.poseIndex, score: match.score })
        localFrames.push(frame)
        localCandidates.push({ frameId: frame.frameId, timestamp, matched: match.reliable, targetScore: match.score,
          ...(target ? phaseGeometry(target.landmarks, size.width / size.height, paddleHand) : { reach: null, wrist: null }) })
        recordEvidence(timestamp, frame.frameId, localCandidates[localCandidates.length - 1])
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      if (generation !== sourceGeneration.current) return
      setRefinedFrames((previous) => [...previous.filter((f) => !localFrames.some((next) => next.frameId === f.frameId)), ...localFrames])
      setRefinement(refinePhases(autoResult, localCandidates, plan))
      setProcessingStatus('Local refinement complete — review timing changes before accepting')
    } catch {
      if (generation === sourceGeneration.current) {
        setRefinement(refinePhases(autoResult, [], plan))
        setProcessingStatus('Local refinement unavailable; coarse proposals retained')
      }
    } finally {
      video.removeAttribute('src')
      video.load()
      if (generation === sourceGeneration.current) setAutoBusy(false)
    }
  }

  const acceptAutomaticPhases = () => {
    if (displayProposals.length !== 3) return
    setSelectedFrameByPhase(Object.fromEntries(displayProposals.map((p) => [p.phase, p.frameId])) as Record<Phase, string>)
    setSelectionOrigin({ ready: 'AUTO', contact: 'AUTO', recovery: 'AUTO' })
    setAnalyses({ ready: null, contact: null, recovery: null })
    setSelectedPoseIndex({ ready: null, contact: null, recovery: null })
    clearStoredVideoBiomechanics(() => window.localStorage, videoFile ? videoFingerprint(videoFile) : null)
    setLastFrameMeta({ ready: null, contact: null, recovery: null })
    imageRefs.current = { ready: null, contact: null, recovery: null }
    Object.values(canvasRefs.current).forEach((canvas) => canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height))
  }

  const analyzeAcceptedPhases = async () => {
    const selected = phases.map((phase) => phaseFrames.find((f) => f.frameId === selectedFrameByPhase[phase]))
    if (selected.some((f) => !f) || !(selected[0]!.timestampSeconds < selected[1]!.timestampSeconds && selected[1]!.timestampSeconds < selected[2]!.timestampSeconds)) {
      setProcessingStatus('Select three distinct frames in Ready → Contact → Recovery order first.')
      return
    }
    if (selected.some((f) => autoCache.current.get(f!.frameId)?.poseIndex == null)) {
      setProcessingStatus('TARGET_A is unresolved in a selected frame. Use the manual analysis and player-selection fallback.')
      return
    }
    const generation = sourceGeneration.current
    setAutoBusy(true)
    try {
      for (const [index, phase] of phases.entries()) {
        const frame = selected[index]!
        const entry = autoCache.current.get(frame.frameId)!
        imageRefs.current[phase] = entry.image
        const size = { width: entry.image.naturalWidth, height: entry.image.naturalHeight }
        setCanvasSizes((s) => ({ ...s, [phase]: size }))
        setLastFrameMeta((s) => ({ ...s, [phase]: { timestampSeconds: frame.timestampSeconds, ...size } }))
        setPhaseVideoFingerprint((s) => ({ ...s, [phase]: videoFile ? videoFingerprint(videoFile) : null }))
        await handleDetectPose(phase, { ...entry, poseIndex: entry.poseIndex! })()
        if (generation !== sourceGeneration.current) return
      }
      setProcessingStatus('Selected frames analyzed for TARGET_A; existing biomechanics reliability gates applied')
    } finally {
      if (generation === sourceGeneration.current) setAutoBusy(false)
    }
  }

  const scoreMatch = scorePlayerMatch

  const handleDetectPose = (phase: Phase, automatic?: { image: HTMLImageElement; poses: PoseResult[]; poseIndex: number; score: number }) => async () => {
    const generation = sourceGeneration.current
    setError((e) => ({ ...e, [phase]: null }))
    setLoading((l) => ({ ...l, [phase]: true }))
    try {
      const image = automatic?.image ?? imageRefs.current[phase]
      const canvas = canvasRefs.current[phase]
      const size = image ? { width: image.naturalWidth, height: image.naturalHeight } : canvasSizes[phase]
      if (!image) {
        setError((e) => ({ ...e, [phase]: 'Upload an image before detecting pose.' }))
        return
      }

      drawImageFor(canvas, image, size)
      const startTime = performance.now()
      const poseResults = automatic?.poses ?? await detectMultiPass(image, { width: image.naturalWidth, height: image.naturalHeight })
      if (generation !== sourceGeneration.current) return
      const processingTimeMs = Math.round(performance.now() - startTime)

      if (!poseResults || poseResults.length === 0) {
        setError((e) => ({ ...e, [phase]: 'No poses detected.' }))
        setAnalyses((a) => ({ ...a, [phase]: { poses: [], averageConfidence: 0, averageVisibility: 0, processingTimeMs } }))
        return
      }

      const averageVisibility = calculateAverage(poseResults.map((pose) => pose.averageVisibility))
      const averageConfidence = calculateAverage(poseResults.map((pose) => pose.detectionConfidence))

      // Per-pose biomechanics diagnostics
      const perPoseDiagnostics = poseResults.map((p) => {
        const b = calculateBiomechanics(p, size.width, size.height)
        // try to find a FULL_FRAME match to compare if this pose came from a crop
        const fullMatch = poseResults.find((q) => q.detectionSource === 'FULL_FRAME' && iou(q.bbox, p.bbox) > 0.5)
        let fullCompare = null
        if (fullMatch && fullMatch !== p) {
          const bf = calculateBiomechanics(fullMatch, size.width, size.height)
          // image-space diffs
          const imageDiffs = {
            leftKneeAngleDiff: (b.leftKneeAngle ?? NaN) - (bf.leftKneeAngle ?? NaN),
            rightKneeAngleDiff: (b.rightKneeAngle ?? NaN) - (bf.rightKneeAngle ?? NaN),
            torsoLeanDiff: (b.torsoLean ?? NaN) - (bf.torsoLean ?? NaN),
            shoulderTiltDiff: (b.shoulderTilt ?? NaN) - (bf.shoulderTilt ?? NaN),
            stanceRatioDiff: (b.rawStanceRatio ?? NaN) - (bf.rawStanceRatio ?? NaN),
          }

          // world-space diffs (if worldLandmarks present on both)
          let worldDiffs = null
          try {
            const LEFT_HIP = 23
            const RIGHT_HIP = 24
            const LEFT_KNEE = 25
            const RIGHT_KNEE = 26
            const LEFT_ANKLE = 27
            const RIGHT_ANKLE = 28
            const LEFT_SHOULDER = 11
            const RIGHT_SHOULDER = 12

            if (p.worldLandmarks && fullMatch.worldLandmarks) {
              const wp = p.worldLandmarks
              const wf = fullMatch.worldLandmarks

              const lHipP = wp[LEFT_HIP]
              const lKneeP = wp[LEFT_KNEE]
              const lAnkP = wp[LEFT_ANKLE]
              const rHipP = wp[RIGHT_HIP]
              const rKneeP = wp[RIGHT_KNEE]
              const rAnkP = wp[RIGHT_ANKLE]
              const lShP = wp[LEFT_SHOULDER]
              const rShP = wp[RIGHT_SHOULDER]

              const lHipF = wf[LEFT_HIP]
              const lKneeF = wf[LEFT_KNEE]
              const lAnkF = wf[LEFT_ANKLE]
              const rHipF = wf[RIGHT_HIP]
              const rKneeF = wf[RIGHT_KNEE]
              const rAnkF = wf[RIGHT_ANKLE]
              const lShF = wf[LEFT_SHOULDER]
              const rShF = wf[RIGHT_SHOULDER]

              const leftKneeAngle3D_P = angleBetween3Points3D(lHipP, lKneeP, lAnkP)
              const rightKneeAngle3D_P = angleBetween3Points3D(rHipP, rKneeP, rAnkP)
              const leftKneeFlex3D_P = Number.isNaN(leftKneeAngle3D_P) ? NaN : 180 - leftKneeAngle3D_P
              const rightKneeFlex3D_P = Number.isNaN(rightKneeAngle3D_P) ? NaN : 180 - rightKneeAngle3D_P

              const leftKneeAngle3D_F = angleBetween3Points3D(lHipF, lKneeF, lAnkF)
              const rightKneeAngle3D_F = angleBetween3Points3D(rHipF, rKneeF, rAnkF)
              const leftKneeFlex3D_F = Number.isNaN(leftKneeAngle3D_F) ? NaN : 180 - leftKneeAngle3D_F
              const rightKneeFlex3D_F = Number.isNaN(rightKneeAngle3D_F) ? NaN : 180 - rightKneeAngle3D_F

              // world distances
              let worldAnkleDistP = NaN
              let worldShoulderDistP = NaN
              let worldAnkleDistF = NaN
              let worldShoulderDistF = NaN
              if (lAnkP && rAnkP) worldAnkleDistP = Math.hypot(lAnkP.x - rAnkP.x, lAnkP.y - rAnkP.y, (lAnkP.z ?? 0) - (rAnkP.z ?? 0))
              if (lShP && rShP) worldShoulderDistP = Math.hypot(lShP.x - rShP.x, lShP.y - rShP.y, (lShP.z ?? 0) - (rShP.z ?? 0))
              if (lAnkF && rAnkF) worldAnkleDistF = Math.hypot(lAnkF.x - rAnkF.x, lAnkF.y - rAnkF.y, (lAnkF.z ?? 0) - (rAnkF.z ?? 0))
              if (lShF && rShF) worldShoulderDistF = Math.hypot(lShF.x - rShF.x, lShF.y - rShF.y, (lShF.z ?? 0) - (rShF.z ?? 0))

              // torso vectors
              const sMidP = { x: (lShP.x + rShP.x) / 2, y: (lShP.y + rShP.y) / 2, z: ((lShP.z ?? 0) + (rShP.z ?? 0)) / 2 }
              const hMidP = { x: (lHipP.x + rHipP.x) / 2, y: (lHipP.y + rHipP.y) / 2, z: ((lHipP.z ?? 0) + (rHipP.z ?? 0)) / 2 }
              const vP = { x: sMidP.x - hMidP.x, y: sMidP.y - hMidP.y, z: sMidP.z - hMidP.z }
              const sMidF = { x: (lShF.x + rShF.x) / 2, y: (lShF.y + rShF.y) / 2, z: ((lShF.z ?? 0) + (rShF.z ?? 0)) / 2 }
              const hMidF = { x: (lHipF.x + rHipF.x) / 2, y: (lHipF.y + rHipF.y) / 2, z: ((lHipF.z ?? 0) + (rHipF.z ?? 0)) / 2 }
              const vF = { x: sMidF.x - hMidF.x, y: sMidF.y - hMidF.y, z: sMidF.z - hMidF.z }

              const dotVF = vP.x * vF.x + vP.y * vF.y + vP.z * vF.z
              const magVP = Math.hypot(vP.x, vP.y, vP.z)
              const magVF = Math.hypot(vF.x, vF.y, vF.z)
              const torsoVectorAngle = (magVP === 0 || magVF === 0) ? NaN : (Math.acos(clamp(dotVF / (magVP * magVF), -1, 1)) * 180) / Math.PI

              worldDiffs = {
                leftKneeAngle3D_P,
                rightKneeAngle3D_P,
                leftKneeFlex3D_P,
                rightKneeFlex3D_P,
                leftKneeAngle3D_F,
                rightKneeAngle3D_F,
                leftKneeFlex3D_F,
                rightKneeFlex3D_F,
                worldAnkleDistP,
                worldShoulderDistP,
                worldAnkleDistF,
                worldShoulderDistF,
                worldAnkleScale: worldAnkleDistP && worldAnkleDistF ? worldAnkleDistP / worldAnkleDistF : NaN,
                worldShoulderScale: worldShoulderDistP && worldShoulderDistF ? worldShoulderDistP / worldShoulderDistF : NaN,
                torsoVectorAngleBetween: torsoVectorAngle,
              }
            }
          } catch (e) {
            // ignore
          }

          fullCompare = { imageDiffs, worldDiffs }
        }
        return { poseIndex: p.poseIndex, detectionSource: p.detectionSource, bbox: p.bbox, averageVisibility: p.averageVisibility, biomechanics: b, compareToFullFrame: fullCompare }
      })

      const analysisResult: any = {
        poses: poseResults,
        averageConfidence,
        averageVisibility,
        processingTimeMs,
        detectionInfo: {
          numPoses: 4,
          minPoseDetectionConfidence: 0.3,
          minPosePresenceConfidence: 0.2,
          minTrackingConfidence: 0.2,
          inputWidth: image.naturalWidth,
          inputHeight: image.naturalHeight,
          inputIsThumbnail: false,
        },
        perPoseDiagnostics,
      }

      setAnalyses((a) => ({ ...a, [phase]: analysisResult }))

      // After analysis, if we have an anchor and this is not the ready phase,
      // attempt automatic matching unless user already manually overrode.
      if (automatic) {
        setSelectedPoseIndex((s) => ({ ...s, [phase]: automatic.poseIndex }))
        setPersistentAssignment((s) => ({ ...s, [phase]: { persistentPlayerId: 'TARGET_A', poseIndex: automatic.poseIndex, score: automatic.score, manual: false } }))
      } else if (persistentAnchor && phase !== 'ready') {
        const anchor = persistentAnchor.features
        const size = canvasSizes[phase]
        const candidates = poseResults.map((p) => ({ pose: p, features: extractFeatures(p, size) }))
        const scored = candidates.map((c) => ({ poseIndex: c.pose.poseIndex, ...scoreMatch(anchor, c.features) }))
        setMatchCandidates((m) => ({ ...m, [phase]: scored }))

        // choose best
        const best = scored.reduce((bestSoFar, cur) => (cur.overall > (bestSoFar?.overall ?? -1) ? cur : bestSoFar), null as any)
        const MATCH_THRESHOLD = 0.6
        if (best && best.overall >= MATCH_THRESHOLD) {
          // assign match
          setSelectedPoseIndex((s) => ({ ...s, [phase]: best.poseIndex }))
          setPersistentAssignment((pa) => ({ ...pa, [phase]: { persistentPlayerId: persistentAnchor.id, poseIndex: best.poseIndex, score: best.overall, manual: false } }))
          drawResults(poseResults, canvasRefs.current[phase], imageRefs.current[phase], canvasSizes[phase], best.poseIndex)
        } else {
          // no confident match
          setPersistentAssignment((pa) => ({ ...pa, [phase]: { persistentPlayerId: persistentAnchor.id, poseIndex: undefined, score: best?.overall ?? 0, manual: false } }))
          drawResults(poseResults, canvasRefs.current[phase], imageRefs.current[phase], canvasSizes[phase], null)
        }
      } else {
        drawResults(poseResults, canvasRefs.current[phase], imageRefs.current[phase], canvasSizes[phase], selectedPoseIndex[phase])
      }
    } catch (err) {
      if (generation !== sourceGeneration.current) return
      console.error(err)
      setError((e) => ({ ...e, [phase]: 'Pose detection failed. Check console for details.' }))
    } finally {
      if (generation === sourceGeneration.current) setLoading((l) => ({ ...l, [phase]: false }))
    }
  }

  const handleDownloadAnnotatedImage = (phase: Phase) => {
    const canvas = canvasRefs.current[phase]
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `pose-test-annotated-${phase}.png`
      link.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  // per-phase canvas click handler and redraw logic
  const handleCanvasClickPhase = (phase: Phase) => (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (autoBusy) return
    const canvas = canvasRefs.current[phase]
    const analysis = analyses[phase]
    if (!canvas || !analysis) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const x = (e.clientX - rect.left) * scaleX
    const y = (e.clientY - rect.top) * scaleY
    for (const pose of analysis.poses) {
      const { left, top, width, height } = pose.bbox
      if (x >= left && x <= left + width && y >= top && y <= top + height) {
        setSelectionOrigin((s) => overridePhase(s, phase, 'MANUAL OVERRIDE'))
        // Manual selection: always set selected index and mark manual override
        setSelectedPoseIndex((s) => phase === 'ready' && s.ready !== pose.poseIndex
          ? { ready: pose.poseIndex, contact: null, recovery: null }
          : { ...s, [phase]: pose.poseIndex })
        setPersistentAssignment((pa) => ({ ...pa, [phase]: { persistentPlayerId: persistentAnchor ? persistentAnchor.id : undefined, poseIndex: pose.poseIndex, score: 1, manual: true } }))
        // If selecting in ready phase, set as anchor
        if (phase === 'ready') {
          const features = extractFeatures(pose, canvasSizes[phase])
          sourceGeneration.current += 1
          setAutoResult(null); setRefinement(null); setLocalEvidence([])
          setAutoBusy(false)
          autoCache.current.clear()
          setPersistentAnchor({ id: 'TARGET_A', features })
          setPersistentAssignment((pa) => ({ ...pa, ready: { persistentPlayerId: 'TARGET_A', poseIndex: pose.poseIndex, score: 1, manual: true } }))
        }
        drawResults(analysis.poses, canvasRefs.current[phase], imageRefs.current[phase], canvasSizes[phase], pose.poseIndex)
        return
      }
    }
  }

  useEffect(() => {
    // redraw when analyses or selections change for any phase
    phases.forEach((phase) => {
      const analysis = analyses[phase]
      const sel = selectedPoseIndex[phase]
      if (analysis && canvasRefs.current[phase] && imageRefs.current[phase]) {
        drawResults(analysis.poses, canvasRefs.current[phase], imageRefs.current[phase], canvasSizes[phase], sel)
      }
    })
  }, [analyses, selectedPoseIndex, canvasSizes])

  // Precompute movement comparison metrics outside JSX to avoid TSX parsing issues
  const getBioForPhase = (phase: Phase) => {
    const a = analyses[phase]
    const sel = selectedPoseIndex[phase]
    if (!a || !sel) return null
    const pose = a.poses.find((p) => p.poseIndex === sel) ?? null
    if (!pose) return null
    return calculateBiomechanics(pose, canvasSizes[phase].width, canvasSizes[phase].height)
  }

  const bioR = getBioForPhase('ready')
  const bioC = getBioForPhase('contact')
  const bioX = getBioForPhase('recovery')

  // Build canonical metrics per phase preferring world-space when valid
  const buildCanonical = (bio: any) => {
    if (!bio) return null
    const canonical: any = {}

    // Stance: prefer worldStanceRatio if available and positive
    // Stance: prefer world for diagnostics but IMAGE for coaching eligibility due to orientation sensitivity
    if (!Number.isNaN(bio.rawStanceRatio) && Number.isFinite(bio.rawStanceRatio) && bio.rawStanceRatio > 0) {
      const reliability = bio.orientationReliability === 'Low' ? 'Low' : bio.stanceConf >= 0.6 ? 'High' : bio.stanceConf >= 0.4 ? 'Medium' : 'Low'
      const coachingEligible = reliability === 'High' && bio.orientationReliability === 'High' && bio.stanceDenominatorStable
      const reason = coachingEligible ? '' : [
        'Camera/body orientation or stance-width normalization is unreliable.',
        ...(bio.orientationReasons ?? []),
        ...(bio.orientationCautions ?? []),
        !bio.stanceDenominatorStable ? 'Projected shoulder span is an unstable stance-width denominator.' : '',
      ].filter(Boolean).join(' ')
      canonical.stance = {
        value: bio.rawStanceRatio,
        unit: 'x',
        source: 'image',
        reliability,
        coachingEligible,
        reason,
        rawValue: bio.rawStanceRatio,
        diagnostics: { ankleDistance2D: bio.ankleDistNorm, shoulderDistance2D: bio.shoulderDistNorm, orientationReliability: bio.orientationReliability, orientationSignature: bio.orientationSignature, stanceDenominatorStable: bio.stanceDenominatorStable, worldStanceRatio: bio.worldStanceRatio, worldAnkleDistance: bio.worldAnkleDistance, worldShoulderDistance: bio.worldShoulderDistance },
      }
    } else {
      canonical.stance = { value: NaN, unit: 'x', source: 'fallback', reliability: 'Low', coachingEligible: false, reason: 'No valid stance measurements', rawValue: NaN, diagnostics: {} }
    }

    // Knee flexion: compute both image and world candidate
    const makeKnee = (side: 'left' | 'right') => {
      const joint = side === 'left' ? (bio.leftKneeAngle ?? NaN) : (bio.rightKneeAngle ?? NaN)
      const flex = side === 'left' ? (bio.leftKneeFlexion ?? NaN) : (bio.rightKneeFlexion ?? NaN)
      const conf = side === 'left' ? bio.leftKneeConf : bio.rightKneeConf
      const reliability = conf >= 0.7 ? 'High' : conf >= 0.4 ? 'Medium' : 'Low'
      const geometryEligible = bio.orientationReliability !== 'Low'
      const coachingEligible = (reliability === 'High' || reliability === 'Medium') && geometryEligible
      const reason = coachingEligible ? '' : [
        reliability === 'Low' ? 'Insufficient landmark visibility for reliable knee flexion.' : '',
        !geometryEligible ? 'Severe body rotation/foreshortening makes image-space knee flexion unreliable.' : '',
        ...(bio.orientationReasons ?? []),
      ].filter(Boolean).join(' ')
      return {
        value: flex,
        unit: '°',
        source: 'image',
        reliability,
        coachingEligible: coachingEligible && !Number.isNaN(flex),
        reason: coachingEligible && !Number.isNaN(flex) ? '' : reason,
        rawValue: flex,
        diagnostics: { jointAngle: joint, orientationReliability: bio.orientationReliability, orientationSignature: bio.orientationSignature },
        worldCandidate: { value: NaN, available: false, coachingEligible: false, reason: 'World knee flexion experimental; use full-frame world detections only.' },
      }
    }

    canonical.kneeLeft = makeKnee('left')
    canonical.kneeRight = makeKnee('right')

    // Torso: prefer worldTorsoLean when available
    // Torso: prefer IMAGE-space normalized torso lean for coaching eligibility
    {
      const reliability = bio.torsoConf >= 0.7 ? 'High' : bio.torsoConf >= 0.4 ? 'Medium' : 'Low'
      const coachingEligible = reliability === 'High' && bio.orientationReliability !== 'Low'
      const reason = coachingEligible ? '' : [
        reliability !== 'High' ? 'Insufficient shoulder/hip visibility for reliable torso lean.' : '',
        bio.orientationReliability === 'Low' ? 'Severe body rotation/foreshortening makes image-space torso lean unreliable.' : '',
        ...(bio.orientationReasons ?? []),
      ].filter(Boolean).join(' ')
      canonical.torso = {
        value: bio.torsoLean,
        unit: '°',
        source: 'image',
        reliability,
        coachingEligible,
        reason,
        rawValue: bio.torsoLean,
        diagnostics: { imageTorsoRaw: bio.torsoLean, orientationSignature: bio.orientationSignature, worldTorsoLeanRaw: bio.worldTorsoLeanRaw, worldTorsoLean: bio.worldTorsoLean },
      }
    }

    // Shoulders: keep image tilt as canonical for now, provide world candidate if present
    // For coaching: use absolute magnitude; signed tilt preserved in diagnostics
    {
      const rel = bio.shoulderTiltConf >= 0.7 ? 'High' : bio.shoulderTiltConf >= 0.4 ? 'Medium' : 'Low'
      const magnitude = Math.abs(bio.shoulderTilt)
      const coachingEligible = rel === 'High' && bio.orientationReliability === 'High'
      const reason = coachingEligible ? '' : [
        'Shoulder tilt magnitude is unreliable due to orientation or low visibility.',
        ...(bio.orientationReasons ?? []),
        ...(bio.orientationCautions ?? []),
      ].filter(Boolean).join(' ')
      canonical.shoulder = {
        value: magnitude,
        unit: '°',
        source: 'image',
        reliability: rel,
        coachingEligible,
        reason,
        rawValue: bio.rawShoulderAngle,
        diagnostics: { imageRaw: bio.rawShoulderAngle, signedTilt: bio.shoulderTilt, orientationSignature: bio.orientationSignature },
        worldCandidate: { available: !Number.isNaN(bio.worldShoulderDistance), value: bio.worldShoulderDistance ?? NaN, coachingEligible: false, reason: 'World shoulder metrics experimental.' },
      }
    }

    return canonical
  }

  const canR = buildCanonical(bioR)
  const canC = buildCanonical(bioC)
  const canX = buildCanonical(bioX)

  const canonicalMetrics = { ready: canR, contact: canC, recovery: canX }
  const currentFingerprint = videoFile ? videoFingerprint(videoFile) : null
  const sourceMatches = phases.every((phase) => !canonicalMetrics[phase] || phaseVideoFingerprint[phase] === currentFingerprint)
  const coachingBiomechanics = buildCoachingBiomechanicsPayload(canonicalMetrics, sourceMatches ? currentFingerprint : null)
  const storedPayload = JSON.stringify(coachingBiomechanics)
  const hasBridgeInput = !!videoFile || phases.some((phase) => files[phase] || analyses[phase])

  // Development bridge for the next pipeline step. Only the whitelisted payload
  // is persisted; canonical diagnostics and landmarks never cross this boundary.
  useEffect(() => {
    // Opening an empty pose tab must not erase another tab's completed analysis.
    if (!hasBridgeInput) return
    const payload = JSON.parse(storedPayload)
    const hasTrustedMetrics = payload.phases.some((phase: { metrics: unknown[] }) => phase.metrics.length > 0)
    try {
      if (hasTrustedMetrics) {
        window.localStorage.setItem(COACHING_BIOMECHANICS_STORAGE_KEY, storedPayload)
      } else {
        clearStoredVideoBiomechanics(() => window.localStorage, currentFingerprint)
      }
    } catch {
      // Storage may be unavailable; pose analysis remains usable without the bridge.
    }
  }, [storedPayload, hasBridgeInput, currentFingerprint])

  const content = (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl shadow-slate-950/40">
          <div className="mb-8 flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-950/80 p-6 text-slate-100 shadow-sm shadow-slate-950/20 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">Pose Test — Upload images for Ready / Contact / Recovery</div>
            </div>
            {/* Video upload and frame timeline card (styled to match existing UI) */}
            <div className="mt-6">
              <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6">
                <div className="mb-2 text-sm text-slate-300">Upload a single video to extract candidate frames (browser-only)</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    {videoUrl ? <video src={videoUrl} controls className="w-full rounded-2xl bg-black" /> : <div className="h-36 rounded-2xl bg-slate-900/40 flex items-center justify-center text-sm text-slate-400">No video loaded</div>}
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm text-slate-300">{videoMeta ? `Duration: ${videoMeta.duration.toFixed(2)}s • ${videoMeta.width}x${videoMeta.height}` : (videoFile ? videoFile.name : 'Video file not selected')}</div>
                    <div className="flex gap-2">
                      <label className="inline-flex items-center justify-center rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 cursor-pointer">
                        <input type="file" accept="video/*" onChange={handleVideoChange} className="hidden" />
                        Choose Video
                      </label>
                      <button type="button" onClick={extractCandidateFrames} disabled={autoBusy || extracting || !videoUrl} className="inline-flex items-center justify-center rounded-2xl border border-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-300">
                        {extracting ? 'Extracting...' : 'Extract Frames'}
                      </button>
                      <button type="button" onClick={() => { resetVideoAnalysis(); setFrames([]); setVideoUrl(null); setVideoFile(null); }} className="inline-flex items-center justify-center rounded-2xl border border-rose-500 px-4 py-2 text-sm text-rose-300">
                        Clear Video
                      </button>
                    </div>
                    <div className="text-xs text-slate-400">Status: {processingStatus ?? 'Idle'}</div>
                  </div>
                </div>

                {frames && frames.length > 0 ? (
                  <div className="mt-4">
                    <div className="mb-2 text-sm text-slate-300">Candidate frames ({frames.length}) — select a phase then click a thumbnail to assign</div>
                    <div className="flex gap-3 items-center mb-3">
                      <button onClick={() => setSelectedPhaseToAssign('ready')} className={`px-3 py-1 rounded ${selectedPhaseToAssign === 'ready' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}`}>Assign Ready</button>
                      <button onClick={() => setSelectedPhaseToAssign('contact')} className={`px-3 py-1 rounded ${selectedPhaseToAssign === 'contact' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}`}>Assign Contact</button>
                      <button onClick={() => setSelectedPhaseToAssign('recovery')} className={`px-3 py-1 rounded ${selectedPhaseToAssign === 'recovery' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}`}>Assign Recovery</button>
                      <div className="ml-4 text-sm text-slate-300">Selected phase: <strong>{selectedPhaseToAssign.toUpperCase()}</strong></div>
                    </div>
                    <div className="grid grid-cols-6 gap-2">
                      {frames.map((f) => (
                        <div key={f.frameId} className="cursor-pointer" onClick={() => assignFrameToPhase(selectedPhaseToAssign, f.frameId)}>
                          <img src={f.imageDataUrl} alt={`frame-${f.frameId}`} className="w-full rounded" />
                          <div className="text-xs text-slate-400 text-center">{f.timestampSeconds.toFixed(2)}s</div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 text-sm text-slate-200">
                      <div>Ready Position: {selectedFrameByPhase.ready ? `${(phaseFrames.find(f=>f.frameId===selectedFrameByPhase.ready)?.timestampSeconds ?? 0).toFixed(2)}s` : '—'}</div>
                      <div>Contact Point: {selectedFrameByPhase.contact ? `${(phaseFrames.find(f=>f.frameId===selectedFrameByPhase.contact)?.timestampSeconds ?? 0).toFixed(2)}s` : '—'}</div>
                      <div>Recovery Step: {selectedFrameByPhase.recovery ? `${(phaseFrames.find(f=>f.frameId===selectedFrameByPhase.recovery)?.timestampSeconds ?? 0).toFixed(2)}s` : '—'}</div>
                    </div>

                    <div className="mt-4 flex items-center gap-3">
                      <button type="button" onClick={analyzeSelectedFrames} disabled={autoBusy || loading.ready || !selectedFrameByPhase.ready} className="inline-flex items-center justify-center rounded-2xl bg-emerald-500 px-6 py-3 text-base font-semibold text-slate-950">
                        Analyze Ready Frame
                      </button>
                      <button type="button" onClick={analyzeRemainingAfterAnchor} disabled={autoBusy || loading.contact || loading.recovery || !selectedFrameByPhase.contact || !selectedFrameByPhase.recovery} className="inline-flex items-center justify-center rounded-2xl border border-emerald-500 px-6 py-3 text-base font-semibold text-emerald-300">
                        Analyze Contact & Recovery (after TARGET_A)
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

              {frames.length > 0 && <section className="rounded-3xl border border-slate-700 bg-slate-950 p-6 space-y-3">
                <h2 className="text-xl font-semibold">Automatic Phase Detection</h2>
                <p className="text-sm text-slate-300">Assign one clear frame to Ready, analyze it, and click the physical player once to identify TARGET_A. Then scan the video. Manual assignment remains available.</p>
                <label className="block">Paddle hand <select aria-label="Paddle hand" value={paddleHand} disabled={autoBusy} onChange={(e) => { setPaddleHand(e.target.value as 'left' | 'right'); setAutoResult(null); setRefinement(null); setLocalEvidence([]); autoCache.current.clear() }} className="bg-slate-800 p-2"><option value="right">Right</option><option value="left">Left</option></select></label>
                <button type="button" disabled={!persistentAnchor || autoBusy || extracting || phases.some((p) => loading[p])} onClick={runAutomaticPhases} className="rounded bg-emerald-600 p-3 disabled:opacity-40">{autoBusy ? 'Scanning / analyzing…' : 'Propose automatic phases'}</button>
                {autoResult && <>
                  <button type="button" disabled={autoBusy || autoResult.proposals.length !== 3} onClick={runLocalRefinement} className="rounded border border-emerald-500 p-3 disabled:opacity-40">Refine local phase timing</button>
                  {!!localEvidence.length && <details open><summary>Local refinement evidence</summary>
                    <table className="text-xs mb-3"><thead><tr><th>Phase</th><th>Requested</th><th>Extracted / reused</th><th>Pose detected</th><th>Multiple poses</th><th>TARGET_A matched</th><th>Ambiguous</th><th>Low score</th><th>Other rejected / pending</th></tr></thead><tbody>{phases.map((phase) => {
                      const rows = localEvidence.filter((e) => e.phase === phase)
                      return <tr key={phase}><td>{phase}</td><td>{rows.length}</td><td>{rows.filter((e) => e.extracted).length}</td><td>{rows.filter((e) => e.poses > 0).length}</td><td>{rows.filter((e) => e.poses > 1).length}</td><td>{rows.filter((e) => e.poseIndex !== null).length}</td><td>{rows.filter((e) => e.rejection === 'ambiguous').length}</td><td>{rows.filter((e) => e.rejection === 'low score').length}</td><td>{rows.filter((e) => e.rejection && !['ambiguous', 'low score'].includes(e.rejection)).length}</td></tr>
                    })}</tbody></table>
                    <table className="text-xs"><thead><tr><th>Phase / time</th><th>Extracted</th><th>Poses / sources</th><th>TARGET_A index</th><th>Best / second</th><th>Rejection</th><th>Arm geometry</th></tr></thead>
                      <tbody>{localEvidence.map((e) => <tr key={`${e.phase}-${e.timestamp}`}><td>{e.phase} {e.timestamp.toFixed(3)}</td><td>{String(e.extracted)}</td><td>{e.poses} / {e.sources}</td><td>{e.poseIndex ?? '—'}</td><td>{e.score.toFixed(3)} / {e.second?.toFixed(3) ?? '—'}</td><td>{e.rejection ?? 'matched'}</td><td>{String(e.geometry)}</td></tr>)}</tbody></table>
                  </details>}
                  {refinement?.comparison && <details open><summary>Dense baseline versus local challenger</summary><div className="grid grid-cols-3 gap-3">{refinement.comparison.map((c) => <div key={c.phase} className="text-xs">
                    <p>{c.phase}: {c.validCandidates} scored candidates · coarse {c.coarseScore.toFixed(3)} / challenger {c.challengerScore.toFixed(3)} at {c.challengerTimestamp.toFixed(3)}s</p>
                    <img alt={`Local challenger ${c.phase}`} src={phaseFrames.find((f) => f.frameId === c.challengerFrameId)?.imageDataUrl} />
                  </div>)}</div></details>}
                  {autoResult.reasons.map((reason) => <p key={reason} className="text-sm text-amber-200">{reason}</p>)}
                  {!autoResult.proposals.length && <p>Unresolved — keep manual selection.</p>}
                  <div className="grid gap-4 md:grid-cols-3">{displayProposals.map((proposal) => {
                    const frame = phaseFrames.find((f) => f.frameId === proposal.frameId)!
                    const entry = autoCache.current.get(proposal.frameId)
                    const target = entry?.poses.find((p) => p.poseIndex === entry.poseIndex)
                    return <article key={proposal.phase} className="border border-slate-600 p-3" aria-label={`Automatic ${proposal.phase}`}>
                      <h3 className="capitalize font-semibold">{proposal.phase}: {proposal.timestamp.toFixed(2)}s</h3>
                      <div className="relative"><img src={frame.imageDataUrl} alt={`Automatic ${proposal.phase} at ${proposal.timestamp.toFixed(2)} seconds`} />
                        {target && entry && <div className="absolute border-2 border-emerald-400 pointer-events-none" style={{ left: `${100 * target.bbox.left / entry.image.naturalWidth}%`, top: `${100 * target.bbox.top / entry.image.naturalHeight}%`, width: `${100 * target.bbox.width / entry.image.naturalWidth}%`, height: `${100 * target.bbox.height / entry.image.naturalHeight}%` }}><span className="bg-slate-950 text-xs text-emerald-300">TARGET_A</span></div>}
                      </div>
                      <p>Confidence: {proposal.confidence} · Score: {proposal.score.toFixed(2)}</p>
                      {refinement?.details.filter((d) => d.phase === proposal.phase).map((d) => <div key={d.phase} className="text-sm text-amber-200">
                        <p>Coarse: {d.coarseTimestamp.toFixed(2)}s · Refined: {d.refinedTimestamp.toFixed(2)}s · Adjustment: {d.adjustment >= 0 ? '+' : ''}{d.adjustment.toFixed(2)}s</p>
                        <p>{d.accepted ? 'Refined' : 'Coarse retained'}: {d.reason}</p>
                      </div>)}
                      <ul className="list-disc pl-4 text-sm">{proposal.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                    </article>
                  })}</div>
                  {displayProposals.length === 3 && <button disabled={autoBusy} type="button" onClick={acceptAutomaticPhases} className="rounded bg-emerald-600 p-3">Accept proposals after visual review</button>}
                  <details><summary>Candidate evidence (development)</summary><table className="text-xs"><thead><tr><th>Time</th><th>Target matched</th><th>Match score</th><th>Arm reach / torso</th><th>Local motion</th></tr></thead><tbody>{autoResult.candidates.map((c) => <tr key={c.frameId}><td>{c.timestamp.toFixed(2)}</td><td>{c.matched ? 'TARGET_A' : 'unresolved'}</td><td>{c.targetScore.toFixed(2)}</td><td>{c.reach?.toFixed(2) ?? 'unavailable'}</td><td>{c.motion?.toFixed(2) ?? 'unavailable'}</td></tr>)}</tbody></table></details>
                </>}
                <div className="text-sm">{phases.map((phase) => <p key={phase}>{phase}: {selectionOrigin[phase]} · {phaseFrames.find((f) => f.frameId === selectedFrameByPhase[phase])?.timestampSeconds.toFixed(2) ?? '—'}s</p>)}</div>
                <button type="button" disabled={autoBusy || !displayProposals.length} onClick={analyzeAcceptedPhases} className="rounded border border-emerald-500 p-3 disabled:opacity-40">Analyze selected frames for TARGET_A</button>
              </section>}

              <div className="grid gap-6 lg:grid-cols-[1.75fr_1fr]">
                <div className="space-y-6">
                  {phases.map((phase) => (
                    <div key={phase} className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6">
                      <label className="block text-sm font-semibold text-slate-300">{phase === 'ready' ? 'Ready Position' : phase === 'contact' ? 'Contact Point' : 'Recovery Step'}</label>
                      <input
                        type="file"
                        accept="image/png,image/jpeg"
                        disabled={autoBusy}
                        onChange={handleFileChange(phase)}
                        className="mt-4 w-full cursor-pointer rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20"
                      />

                      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <button
                          type="button"
                          onClick={handleDetectPose(phase)}
                          disabled={autoBusy || !previews[phase] || loading[phase]}
                          className="inline-flex items-center justify-center rounded-2xl bg-emerald-500 px-6 py-3 text-base font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {loading[phase] ? 'Detecting...' : 'Detect Pose'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadAnnotatedImage(phase)}
                          disabled={!analyses[phase] || (analyses[phase] && analyses[phase]!.poses.length === 0)}
                          className="inline-flex items-center justify-center rounded-2xl border border-emerald-500 bg-slate-900 px-6 py-3 text-base font-semibold text-emerald-300 transition hover:border-emerald-400 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Download Annotated Image
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (autoBusy) return
                            if (phase === 'ready') {
                              sourceGeneration.current += 1
                              setPersistentAnchor(null)
                              setAutoResult(null); setRefinement(null); setLocalEvidence([])
                              autoCache.current.clear()
                            }
                            setSelectionOrigin((s) => overridePhase(s, phase, 'MANUAL OVERRIDE'))
                            setSelectedPoseIndex((s) => ({ ...s, [phase]: null }))
                            if (analyses[phase]) drawResults(analyses[phase]!.poses, canvasRefs.current[phase], imageRefs.current[phase], canvasSizes[phase], null)
                          }}
                          className="inline-flex items-center justify-center rounded-2xl border border-rose-500 bg-slate-900 px-4 py-2 text-sm font-semibold text-rose-300 transition hover:border-rose-400 hover:text-rose-200"
                        >
                          Clear Selection
                        </button>
                      </div>

                      {error[phase] ? <p className="mt-4 text-sm text-rose-400">{error[phase]}</p> : null}

                      <div className="mt-4">
                        <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900">
                          <canvas
                            ref={(el) => {
                              canvasRefs.current[phase] = el
                            }}
                            onClick={handleCanvasClickPhase(phase)}
                            width={canvasSizes[phase].width}
                            height={canvasSizes[phase].height}
                            className="w-full"
                          />
                        </div>
                        <img
                          ref={(el) => {
                            // A video frame uses a loaded off-DOM image. The empty
                            // upload preview must not replace it during rerenders.
                            if (previews[phase]) imageRefs.current[phase] = el
                          }}
                          src={previews[phase] ?? undefined}
                          alt={`${phase} preview`}
                          className="hidden"
                          onLoad={() => resizeCanvasToImage(phase)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="space-y-6">
              <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6">
                <h2 className="mb-4 text-xl font-semibold text-slate-100">Summary</h2>
                <div className="space-y-3 text-sm text-slate-300">
                  {phases.map((phase) => {
                    const a = analyses[phase]
                    return (
                      <div key={phase} className="flex items-center justify-between rounded-2xl bg-slate-900/70 px-4 py-3">
                        <span>{phase === 'ready' ? 'Ready' : phase === 'contact' ? 'Contact' : 'Recovery'} — Detected poses</span>
                        <strong>{a ? a.poses.length : 0}</strong>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6">
                <h2 className="mb-4 text-xl font-semibold text-slate-100">Debug Panel</h2>
                <div className="space-y-4">
                  {phases.map((phase) => {
                    const a = analyses[phase]
                    return (
                      <div key={phase} className="space-y-2">
                        <div className="text-sm font-semibold text-slate-100">{phase === 'ready' ? 'Ready Position' : phase === 'contact' ? 'Contact Point' : 'Recovery Step'}</div>
                        {lastFrameMeta[phase] ? (
                          <div className="text-xs text-slate-400">Source: {lastFrameMeta[phase]!.timestampSeconds.toFixed(2)}s • Frame: {lastFrameMeta[phase]!.width}×{lastFrameMeta[phase]!.height}</div>
                        ) : null}
                        {a && (a as any).detectionInfo ? (
                          <div className="text-xs text-slate-400">MediaPipe input: {(a as any).detectionInfo.inputWidth}×{(a as any).detectionInfo.inputHeight} • numPoses: {(a as any).detectionInfo.numPoses} • minPoseDetectionConfidence: {(a as any).detectionInfo.minPoseDetectionConfidence}</div>
                        ) : null}
                        {a && a.poses.length > 0 ? (
                          a.poses.map((pose) => (
                            <div key={`${phase}-${pose.poseIndex}`} className="rounded-3xl border border-slate-800 bg-slate-900/70 p-4">
                              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-300">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-slate-100">Pose #{pose.poseIndex}</span>
                                  {selectedPoseIndex[phase] === pose.poseIndex ? (
                                    <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30">TARGET</span>
                                  ) : null}
                                </div>
                                <span>{pose.landmarks.length} landmarks • {pose.detectionSource ?? 'FULL_FRAME'}</span>
                              </div>
                              <div className="mt-4 grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
                                <div>
                                  <p className="font-medium text-slate-100">Bounding box</p>
                                  <p>Left: {pose.bbox.left.toFixed(1)}</p>
                                  <p>Top: {pose.bbox.top.toFixed(1)}</p>
                                  <p>Width: {pose.bbox.width.toFixed(1)}</p>
                                  <p>Height: {pose.bbox.height.toFixed(1)}</p>
                                </div>
                                <div>
                                  <p className="font-medium text-slate-100">Metrics</p>
                                  <p>Avg visibility: {pose.averageVisibility.toFixed(2)}</p>
                                  <p>Detection confidence: {pose.detectionConfidence.toFixed(2)} • Source: {pose.detectionSource ?? 'FULL_FRAME'}</p>
                                    {matchCandidates[phase] && matchCandidates[phase].length > 0 ? (
                                      (() => {
                                        const cand = matchCandidates[phase].find((c: any) => c.poseIndex === pose.poseIndex)
                                        if (!cand) return null
                                        return (
                                          <div className="mt-2 text-xs text-slate-400">
                                            <div>Match overall: {Math.round((cand.overall ?? 0) * 100)}%</div>
                                            <div>Center: {Math.round((cand.centerScore ?? 0) * 100)}% • Size: {Math.round((cand.sizeScore ?? 0) * 100)}% • Pose: {Math.round((cand.lmDist ?? 0) * 100)}%</div>
                                          </div>
                                        )
                                      })()
                                    ) : null}
                                </div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-sm text-slate-400">No pose results for this phase.</div>
                        )}
                          {a && a.poses.length < 2 && frames.length > 1 ? (
                            <div className="mt-2 text-xs text-rose-400">Possible missed player detection.</div>
                          ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>

              <BiomechanicsPanel
                phases={phases}
                analyses={analyses}
                selectedPoseIndex={selectedPoseIndex}
                canvasSizes={canvasSizes}
                coachingBiomechanics={coachingBiomechanics}
                canonicalMetrics={canonicalMetrics}
                calculateBiomechanics={calculateBiomechanics}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return content
}
