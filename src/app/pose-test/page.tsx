"use client"

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import BiomechanicsPanel from './BiomechanicsPanel'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

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

  // Persistent targeting state
  const [persistentAnchor, setPersistentAnchor] = useState<null | { id: string; features: any }>(null)
  const [persistentAssignment, setPersistentAssignment] = useState<Record<Phase, { persistentPlayerId?: string; poseIndex?: number; score?: number; manual?: boolean }>>({ ready: {}, contact: {}, recovery: {} } as any)
  const [matchCandidates, setMatchCandidates] = useState<Record<Phase, Array<any>>>({ ready: [], contact: [], recovery: [] } as any)

  const imageRefs = useRef<Record<Phase, HTMLImageElement | null>>({} as any)
  const canvasRefs = useRef<Record<Phase, HTMLCanvasElement | null>>({} as any)
  const poseLandmarkerRef = useRef<any>(null)

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

  // Matching score between anchor and candidate (0..1)
  const scoreMatch = (anchor: any, cand: any) => {
    // center distance score
    const dx = anchor.center.x - cand.center.x
    const dy = anchor.center.y - cand.center.y
    const dist = Math.hypot(dx, dy)
    const centerScore = 1 - Math.min(dist / 1.41421356, 1)

    // size/area similarity
    const maxArea = Math.max(anchor.area, cand.area)
    const sizeScore = maxArea > 0 ? 1 - Math.min(Math.abs(anchor.area - cand.area) / maxArea, 1) : 0

    // landmark similarity: average normalized point distance
    const pairs = Math.min(anchor.landmarks.length, cand.landmarks.length)
    let lmDist = 1
    if (pairs > 0) {
      let sum = 0
      for (let i = 0; i < pairs; i++) {
        const a = anchor.landmarks[i]
        const b = cand.landmarks[i]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        sum += d
      }
      const avg = sum / pairs
      lmDist = 1 - Math.min(avg / 0.5, 1)
    }

    // weights
    const wCenter = 0.5
    const wSize = 0.25
    const wLandmark = 0.25

    const overall = wCenter * centerScore + wSize * sizeScore + wLandmark * lmDist
    return { overall, centerScore, sizeScore, lmDist }
  }

  const handleDetectPose = (phase: Phase) => async () => {
    setError((e) => ({ ...e, [phase]: null }))
    setLoading((l) => ({ ...l, [phase]: true }))
    try {
      const image = imageRefs.current[phase]
      const canvas = canvasRefs.current[phase]
      const size = canvasSizes[phase]
      if (!image) {
        setError((e) => ({ ...e, [phase]: 'Upload an image before detecting pose.' }))
        return
      }

      drawImageFor(canvas, image, size)
      const landmarker = await getPoseLandmarker()
      const startTime = performance.now()
      const result = landmarker.detect(image) as any
      const poses = result.landmarks ?? []
      const world = result.worldLandmarks ?? []
      const processingTimeMs = Math.round(performance.now() - startTime)

      if (poses.length === 0) {
        setError((e) => ({ ...e, [phase]: 'No poses detected.' }))
        setAnalyses((a) => ({ ...a, [phase]: { poses: [], averageConfidence: 0, averageVisibility: 0, processingTimeMs } }))
        return
      }

      const poseResults: PoseResult[] = poses.map((landmarks, index) => {
        const normalizedXs = landmarks.map((landmark) => landmark.x)
        const normalizedYs = landmarks.map((landmark) => landmark.y)
        const left = Math.min(...normalizedXs) * size.width
        const top = Math.min(...normalizedYs) * size.height
        const right = Math.max(...normalizedXs) * size.width
        const bottom = Math.max(...normalizedYs) * size.height
        const averageVisibility = calculateAverage(landmarks.map((landmark) => landmark.visibility ?? 0))
        const detectionConfidence = averageVisibility

        return {
          poseIndex: index + 1,
          landmarks,
          worldLandmarks: world[index] ?? null,
          bbox: {
            left: clamp(left, 0, size.width),
            top: clamp(top, 0, size.height),
            width: clamp(right - left, 0, size.width),
            height: clamp(bottom - top, 0, size.height),
          },
          averageVisibility,
          detectionConfidence,
        }
      })

      const averageVisibility = calculateAverage(poseResults.map((pose) => pose.averageVisibility))
      const averageConfidence = calculateAverage(poseResults.map((pose) => pose.detectionConfidence))
      const analysisResult: PoseAnalysis = {
        poses: poseResults,
        averageConfidence,
        averageVisibility,
        processingTimeMs,
      }

      setAnalyses((a) => ({ ...a, [phase]: analysisResult }))

      // After analysis, if we have an anchor and this is not the ready phase,
      // attempt automatic matching unless user already manually overrode.
      if (persistentAnchor && phase !== 'ready') {
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
      console.error(err)
      setError((e) => ({ ...e, [phase]: 'Pose detection failed. Check console for details.' }))
    } finally {
      setLoading((l) => ({ ...l, [phase]: false }))
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
        // Manual selection: always set selected index and mark manual override
        setSelectedPoseIndex((s) => ({ ...s, [phase]: pose.poseIndex }))
        setPersistentAssignment((pa) => ({ ...pa, [phase]: { persistentPlayerId: persistentAnchor ? persistentAnchor.id : undefined, poseIndex: pose.poseIndex, score: 1, manual: true } }))
        // If selecting in ready phase, set as anchor
        if (phase === 'ready') {
          const features = extractFeatures(pose, canvasSizes[phase])
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
    if (!Number.isNaN(bio.worldStanceRatio) && Number.isFinite(bio.worldStanceRatio) && bio.worldStanceRatio > 0) {
      canonical.stance = {
        value: bio.worldStanceRatio,
        unit: 'x',
        source: 'world',
        reliability: bio.stanceConf >= 0.5 ? 'High' : bio.stanceConf >= 0.3 ? 'Medium' : 'Low',
        rawValue: bio.worldStanceRatio,
        diagnostics: { worldAnkleDistance: bio.worldAnkleDistance, worldShoulderDistance: bio.worldShoulderDistance },
      }
    } else if (!Number.isNaN(bio.rawStanceRatio) && Number.isFinite(bio.rawStanceRatio) && bio.rawStanceRatio > 0) {
      canonical.stance = {
        value: bio.rawStanceRatio,
        unit: 'x',
        source: 'image',
        reliability: bio.orientationReliability === 'Low' ? 'Low' : bio.stanceConf >= 0.6 ? 'High' : bio.stanceConf >= 0.4 ? 'Medium' : 'Low',
        rawValue: bio.rawStanceRatio,
        diagnostics: { ankleDistance2D: bio.ankleDistNorm, shoulderDistance2D: bio.shoulderDistNorm, orientationReliability: bio.orientationReliability },
      }
    } else {
      canonical.stance = { value: NaN, unit: 'x', source: 'fallback', reliability: 'Low', rawValue: NaN, diagnostics: {} }
    }

    // Knee flexion: compute both image and world candidate
    const makeKnee = (side: 'left' | 'right') => {
      const joint = side === 'left' ? (bio.leftKneeAngle ?? NaN) : (bio.rightKneeAngle ?? NaN)
      const flex = side === 'left' ? (bio.leftKneeFlexion ?? NaN) : (bio.rightKneeFlexion ?? NaN)
      const worldFlex = NaN
      // world flexion: if worldLandmarks exist, will be computed by calculateBiomechanics as extra fields? We compute here if possible
      // In our calculateBiomechanics we didn't attach per-knee world angles; attempt to compute from pose.worldLandmarks if present via bio.rawWorld? bio does not include worldLandmarks here, so skip.
      return {
        value: flex,
        unit: '°',
        source: 'image',
        reliability: (side === 'left' ? bio.leftKneeConf : bio.rightKneeConf) >= 0.7 ? 'High' : (side === 'left' ? bio.leftKneeConf : bio.rightKneeConf) >= 0.4 ? 'Medium' : 'Low',
        rawValue: flex,
        diagnostics: { jointAngle: joint },
        worldCandidate: { value: worldFlex, available: false },
      }
    }

    canonical.kneeLeft = makeKnee('left')
    canonical.kneeRight = makeKnee('right')

    // Torso: prefer worldTorsoLean when available
    if (!Number.isNaN(bio.worldTorsoLean) && Number.isFinite(bio.worldTorsoLean)) {
      canonical.torso = {
        value: bio.worldTorsoLean,
        unit: '°',
        source: 'world',
        reliability: bio.torsoConf >= 0.5 ? 'High' : bio.torsoConf >= 0.3 ? 'Medium' : 'Low',
        rawValue: bio.worldTorsoLean,
        diagnostics: { worldTorsoRaw: bio.worldTorsoLean, imageTorso: bio.torsoLean },
      }
    } else {
      canonical.torso = {
        value: bio.torsoLean,
        unit: '°',
        source: 'image',
        reliability: bio.torsoConf >= 0.7 ? 'High' : bio.torsoConf >= 0.4 ? 'Medium' : 'Low',
        rawValue: bio.torsoLean,
        diagnostics: { imageTorsoRaw: bio.torsoLean },
      }
    }

    // Shoulders: keep image tilt as canonical for now, provide world candidate if present
    canonical.shoulder = {
      value: bio.shoulderTilt,
      unit: '°',
      source: 'image',
      reliability: bio.shoulderTiltConf >= 0.7 ? 'High' : bio.shoulderTiltConf >= 0.4 ? 'Medium' : 'Low',
      rawValue: bio.rawShoulderAngle,
      diagnostics: { imageRaw: bio.rawShoulderAngle },
      worldCandidate: { available: !Number.isNaN(bio.worldShoulderDistance), value: bio.worldShoulderDistance ?? NaN },
    }

    return canonical
  }

  const canR = buildCanonical(bioR)
  const canC = buildCanonical(bioC)
  const canX = buildCanonical(bioX)

  const avgKnee = (b: any) => {
    if (!b) return NaN
    const vals: number[] = []
    if (!isNaN(b.leftKneeAngle)) vals.push(b.leftKneeAngle)
    if (!isNaN(b.rightKneeAngle)) vals.push(b.rightKneeAngle)
    if (vals.length === 0) return NaN
    return vals.reduce((s, v) => s + v, 0) / vals.length
  }

  const delta = (a: number, b: number) => (isNaN(a) || isNaN(b) ? NaN : b - a)

  const metrics = [
    { key: 'Knee (avg)', a: canR ? ((canR.kneeLeft.value + canR.kneeRight.value) / 2) : NaN, b: canC ? ((canC.kneeLeft.value + canC.kneeRight.value) / 2) : NaN, c: canX ? ((canX.kneeLeft.value + canX.kneeRight.value) / 2) : NaN, unit: '°' },
    { key: 'Torso Lean', a: canR?.torso.value ?? NaN, b: canC?.torso.value ?? NaN, c: canX?.torso.value ?? NaN, unit: '°' },
    { key: 'Stance Width', a: canR?.stance.value ?? NaN, b: canC?.stance.value ?? NaN, c: canX?.stance.value ?? NaN, unit: 'x' },
    { key: 'Shoulder Tilt', a: canR?.shoulder.value ?? NaN, b: canC?.shoulder.value ?? NaN, c: canX?.shoulder.value ?? NaN, unit: '°' },
  ];

  const content = (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl shadow-slate-950/40">
          <div className="mb-8 flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-950/80 p-6 text-slate-100 shadow-sm shadow-slate-950/20 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">Pose Test — Upload images for Ready / Contact / Recovery</div>
            </div>
          </div>

              <div className="grid gap-6 lg:grid-cols-[1.75fr_1fr]">
                <div className="space-y-6">
                  {phases.map((phase) => (
                    <div key={phase} className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6">
                      <label className="block text-sm font-semibold text-slate-300">{phase === 'ready' ? 'Ready Position' : phase === 'contact' ? 'Contact Point' : 'Recovery Step'}</label>
                      <input
                        type="file"
                        accept="image/png,image/jpeg"
                        onChange={handleFileChange(phase)}
                        className="mt-4 w-full cursor-pointer rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20"
                      />

                      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <button
                          type="button"
                          onClick={handleDetectPose(phase)}
                          disabled={!previews[phase] || loading[phase]}
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
                            imageRefs.current[phase] = el
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
                                <span>{pose.landmarks.length} landmarks</span>
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
                                  <p>Detection confidence: {pose.detectionConfidence.toFixed(2)}</p>
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
                metrics={metrics}
                canonicalMetrics={{ ready: canR, contact: canC, recovery: canX }}
                delta={delta}
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
