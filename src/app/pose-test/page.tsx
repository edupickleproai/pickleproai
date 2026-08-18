'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
const WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'

interface PoseResult {
  poseIndex: number
  landmarks: NormalizedLandmark[]
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

  const ankleDistNorm = Math.hypot(leftAnkleN.x - rightAnkleN.x, leftAnkleN.y - rightAnkleN.y)
  const shoulderDistNorm = Math.hypot(leftShoulderN.x - rightShoulderN.x, leftShoulderN.y - rightShoulderN.y)
  const stanceRatio = shoulderDistNorm > 0 ? ankleDistNorm / shoulderDistNorm : NaN
  const stanceConf = ((leftAnkleN.visibility ?? 0) + (rightAnkleN.visibility ?? 0) + (leftShoulderN.visibility ?? 0) + (rightShoulderN.visibility ?? 0)) / 4

  const shoulderTiltConf = ((leftShoulderN.visibility ?? 0) + (rightShoulderN.visibility ?? 0)) / 2

  // Knee flexion (hip -> knee -> ankle), straight leg ~180°, more bend => smaller angle
  const leftKneeAngle = angleBetween3Points(leftHip, leftKnee, leftAnkle)
  const rightKneeAngle = angleBetween3Points(rightHip, rightKnee, rightAnkle)

  // Torso lean: midpoint shoulders -> midpoint hips relative to vertical (0..90)
  const shoulderMid = midpoint(leftShoulder, rightShoulder)
  const hipMid = midpoint(leftHip, rightHip)
  const torsoLineAngle = Math.abs(lineAngleDegrees(hipMid, shoulderMid))
  const torsoLean = Math.abs(90 - torsoLineAngle)

  // Shoulder tilt: absolute acute deviation from horizontal (0..90)
  const rawShoulderAngle = Math.abs(lineAngleDegrees(leftShoulder, rightShoulder))
  const shoulderTilt = rawShoulderAngle > 90 ? 180 - rawShoulderAngle : rawShoulderAngle

  return {
    // angles
    leftKneeAngle,
    rightKneeAngle,
    torsoLean,
    shoulderTilt,
    // normalized distances
    ankleDistNorm,
    shoulderDistNorm,
    stanceRatio,
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
    stanceVisible: stanceConf >= VISIBILITY_THRESHOLD,
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 960, height: 540 })
  const [loading, setLoading] = useState(false)
  const [analysis, setAnalysis] = useState<PoseAnalysis | null>(null)
  const [selectedPoseIndex, setSelectedPoseIndex] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const imageRef = useRef<HTMLImageElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const poseLandmarkerRef = useRef<any>(null)

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null)
      setAnalysis(null)
      setError(null)
      return
    }

    const url = URL.createObjectURL(selectedFile)
    setPreviewUrl(url)
    setAnalysis(null)
    setError(null)

    return () => {
      URL.revokeObjectURL(url)
    }
  }, [selectedFile])

  useEffect(() => {
    return () => {
      if (poseLandmarkerRef.current?.close) {
        poseLandmarkerRef.current.close()
      }
    }
  }, [])

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    setSelectedFile(file)
  }

  const drawImage = () => {
    const canvas = canvasRef.current
    const image = imageRef.current
    if (!canvas || !image) return

    canvas.width = canvasSize.width
    canvas.height = canvasSize.height

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.save()
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#020617'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    ctx.restore()
  }

  const resizeCanvasToImage = () => {
    const image = imageRef.current
    if (!image) return

    const maxWidth = 960
    const maxHeight = 720
    const naturalWidth = image.naturalWidth
    const naturalHeight = image.naturalHeight
    const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1)
    const width = Math.round(naturalWidth * scale)
    const height = Math.round(naturalHeight * scale)
    setCanvasSize({ width, height })
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

  const drawResults = (poses: PoseResult[], selectedIndex: number | null = null) => {
    const canvas = canvasRef.current
    const image = imageRef.current
    if (!canvas || !image) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    drawImage()
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
      const connections = (poseLandmarkerRef.current?.constructor?.POSE_CONNECTIONS ??
        []) as Array<{ start: number; end: number }>
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

  const handleDetectPose = async () => {
    setError(null)
    setLoading(true)

    try {
      if (!imageRef.current) {
        setError('Upload an image before detecting pose.')
        return
      }

      drawImage()
      const landmarker = await getPoseLandmarker()
      const startTime = performance.now()
      const result = landmarker.detect(imageRef.current) as { landmarks?: NormalizedLandmark[][] }
      const processingTimeMs = Math.round(performance.now() - startTime)
      const poses = result.landmarks ?? []

      if (poses.length === 0) {
        setError('No poses detected.')
        setAnalysis({ poses: [], averageConfidence: 0, averageVisibility: 0, processingTimeMs })
        return
      }

      const poseResults: PoseResult[] = poses.map((landmarks, index) => {
        const normalizedXs = landmarks.map((landmark) => landmark.x)
        const normalizedYs = landmarks.map((landmark) => landmark.y)
        const left = Math.min(...normalizedXs) * canvasSize.width
        const top = Math.min(...normalizedYs) * canvasSize.height
        const right = Math.max(...normalizedXs) * canvasSize.width
        const bottom = Math.max(...normalizedYs) * canvasSize.height
        const averageVisibility = calculateAverage(landmarks.map((landmark) => landmark.visibility ?? 0))
        const detectionConfidence = averageVisibility

        return {
          poseIndex: index + 1,
          landmarks,
          bbox: {
            left: clamp(left, 0, canvasSize.width),
            top: clamp(top, 0, canvasSize.height),
            width: clamp(right - left, 0, canvasSize.width),
            height: clamp(bottom - top, 0, canvasSize.height),
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

      setAnalysis(analysisResult)
      drawResults(poseResults, selectedPoseIndex)
    } catch (err) {
      console.error(err)
      setError('Pose detection failed. Check console for details.')
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadAnnotatedImage = () => {
    const canvas = canvasRef.current
    if (!canvas) return

    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'pose-test-annotated.png'
      link.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || !analysis) return

    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const x = (e.clientX - rect.left) * scaleX
    const y = (e.clientY - rect.top) * scaleY

    // find first pose whose bbox contains the point
    for (const pose of analysis.poses) {
      const { left, top, width, height } = pose.bbox
      if (x >= left && x <= left + width && y >= top && y <= top + height) {
        setSelectedPoseIndex(pose.poseIndex)
        drawResults(analysis.poses, pose.poseIndex)
        return
      }
    }

    // click outside any bbox -> do not change selection
  }

  useEffect(() => {
    if (!analysis) return
    drawResults(analysis.poses, selectedPoseIndex)
  }, [analysis, selectedPoseIndex])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl shadow-slate-950/40">
          <div className="mb-8 flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-950/80 p-6 text-slate-100 shadow-sm shadow-slate-950/20 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-emerald-400">Pose Test</p>
              <h1 className="mt-3 text-3xl font-bold sm:text-4xl">MediaPipe Pose Landmarker</h1>
            </div>
            <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
              Ready for MediaPipe
            </span>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.75fr_1fr]">
            <div className="space-y-6">
              <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6">
                <label className="block text-sm font-semibold text-slate-300">Upload a single JPG or PNG</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={handleFileChange}
                  className="mt-4 w-full cursor-pointer rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    onClick={handleDetectPose}
                    disabled={!previewUrl || loading}
                    className="inline-flex items-center justify-center rounded-2xl bg-emerald-500 px-6 py-3 text-base font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? 'Detecting...' : 'Detect Pose'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadAnnotatedImage}
                    disabled={!analysis || analysis.poses.length === 0}
                    className="inline-flex items-center justify-center rounded-2xl border border-emerald-500 bg-slate-900 px-6 py-3 text-base font-semibold text-emerald-300 transition hover:border-emerald-400 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Download Annotated Image
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPoseIndex(null)
                      if (analysis) drawResults(analysis.poses, null)
                    }}
                    className="inline-flex items-center justify-center rounded-2xl border border-rose-500 bg-slate-900 px-4 py-2 text-sm font-semibold text-rose-300 transition hover:border-rose-400 hover:text-rose-200"
                  >
                    Clear Selection
                  </button>
                </div>
                {error ? <p className="mt-4 text-sm text-rose-400">{error}</p> : null}
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm text-slate-300">{selectedPoseIndex ? (
                    <span className="font-semibold text-slate-100">Target Player: Pose #{selectedPoseIndex}</span>
                  ) : (
                    <span className="text-slate-500">Target Player: —</span>
                  )}</div>
                </div>
                <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900">
                  <canvas ref={canvasRef} onClick={handleCanvasClick} width={canvasSize.width} height={canvasSize.height} className="w-full" />
                </div>
                <img ref={imageRef} src={previewUrl ?? undefined} alt="Pose preview" className="hidden" onLoad={resizeCanvasToImage} />
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6">
                <h2 className="mb-4 text-xl font-semibold text-slate-100">Summary</h2>
                <div className="space-y-3 text-sm text-slate-300">
                  <div className="flex items-center justify-between rounded-2xl bg-slate-900/70 px-4 py-3">
                    <span>Detected poses</span>
                    <strong>{analysis ? analysis.poses.length : 0}</strong>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-slate-900/70 px-4 py-3">
                    <span>Average confidence</span>
                    <strong>{analysis ? analysis.averageConfidence.toFixed(2) : '0.00'}</strong>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-slate-900/70 px-4 py-3">
                    <span>Average visibility</span>
                    <strong>{analysis ? analysis.averageVisibility.toFixed(2) : '0.00'}</strong>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-slate-900/70 px-4 py-3">
                    <span>Processing time</span>
                    <strong>{analysis ? `${analysis.processingTimeMs} ms` : '—'}</strong>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6">
                <h2 className="mb-4 text-xl font-semibold text-slate-100">Debug Panel</h2>
                {analysis && analysis.poses.length > 0 ? (
                  <div className="space-y-4">
                    {analysis.poses.map((pose) => (
                      <div key={pose.poseIndex} className="rounded-3xl border border-slate-800 bg-slate-900/70 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-300">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-100">Pose #{pose.poseIndex}</span>
                            {selectedPoseIndex === pose.poseIndex ? (
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
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No pose results yet.</p>
                )}
                {analysis && selectedPoseIndex ? (
                  (() => {
                    const pose = analysis.poses.find((p) => p.poseIndex === selectedPoseIndex) ?? null
                    if (!pose) return null
                    const bio = calculateBiomechanics(pose, canvasSize.width, canvasSize.height)
                    return (
                      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                        <h3 className="mb-2 text-sm font-semibold text-slate-100">BIOMECHANICS DEBUG</h3>
                        <div className="text-xs text-slate-300 space-y-1">
                          <div>Left knee angle: {isNaN(bio.leftKneeAngle) ? 'NaN' : bio.leftKneeAngle.toFixed(3)}</div>
                          <div>Right knee angle: {isNaN(bio.rightKneeAngle) ? 'NaN' : bio.rightKneeAngle.toFixed(3)}</div>
                          <div>Torso lean (deg): {isNaN(bio.torsoLean) ? 'NaN' : bio.torsoLean.toFixed(3)}</div>
                          <div>Shoulder tilt (acute deg): {isNaN(bio.shoulderTilt) ? 'NaN' : bio.shoulderTilt.toFixed(3)}</div>
                          <div>Ankle distance (norm): {isNaN(bio.ankleDistNorm) ? 'NaN' : bio.ankleDistNorm.toFixed(4)}</div>
                          <div>Shoulder distance (norm): {isNaN(bio.shoulderDistNorm) ? 'NaN' : bio.shoulderDistNorm.toFixed(4)}</div>
                          <div>Stance ratio: {isNaN(bio.stanceRatio) ? 'NaN' : bio.stanceRatio.toFixed(4)}</div>
                          <div>Confidences (numeric):</div>
                          <div className="pl-3">LeftKnee: {bio.leftKneeConf.toFixed(3)} ({confidenceLabel(bio.leftKneeConf)})</div>
                          <div className="pl-3">RightKnee: {bio.rightKneeConf.toFixed(3)} ({confidenceLabel(bio.rightKneeConf)})</div>
                          <div className="pl-3">Torso: {bio.torsoConf.toFixed(3)} ({confidenceLabel(bio.torsoConf)})</div>
                          <div className="pl-3">Stance: {bio.stanceConf.toFixed(3)} ({confidenceLabel(bio.stanceConf)})</div>
                          <div className="pl-3">ShoulderTilt: {bio.shoulderTiltConf.toFixed(3)} ({confidenceLabel(bio.shoulderTiltConf)})</div>
                          <div className="mt-2">Raw normalized landmark coords:</div>
                          <div className="pl-3">LeftShoulder: {bio.raw.leftShoulder.x.toFixed(4)},{bio.raw.leftShoulder.y.toFixed(4)} (v:{(bio.raw.leftShoulder.visibility??0).toFixed(3)})</div>
                          <div className="pl-3">RightShoulder: {bio.raw.rightShoulder.x.toFixed(4)},{bio.raw.rightShoulder.y.toFixed(4)} (v:{(bio.raw.rightShoulder.visibility??0).toFixed(3)})</div>
                          <div className="pl-3">LeftHip: {bio.raw.leftHip.x.toFixed(4)},{bio.raw.leftHip.y.toFixed(4)} (v:{(bio.raw.leftHip.visibility??0).toFixed(3)})</div>
                          <div className="pl-3">RightHip: {bio.raw.rightHip.x.toFixed(4)},{bio.raw.rightHip.y.toFixed(4)} (v:{(bio.raw.rightHip.visibility??0).toFixed(3)})</div>
                          <div className="pl-3">LeftKnee: {bio.raw.leftKnee.x.toFixed(4)},{bio.raw.leftKnee.y.toFixed(4)} (v:{(bio.raw.leftKnee.visibility??0).toFixed(3)})</div>
                          <div className="pl-3">RightKnee: {bio.raw.rightKnee.x.toFixed(4)},{bio.raw.rightKnee.y.toFixed(4)} (v:{(bio.raw.rightKnee.visibility??0).toFixed(3)})</div>
                          <div className="pl-3">LeftAnkle: {bio.raw.leftAnkle.x.toFixed(4)},{bio.raw.leftAnkle.y.toFixed(4)} (v:{(bio.raw.leftAnkle.visibility??0).toFixed(3)})</div>
                          <div className="pl-3">RightAnkle: {bio.raw.rightAnkle.x.toFixed(4)},{bio.raw.rightAnkle.y.toFixed(4)} (v:{(bio.raw.rightAnkle.visibility??0).toFixed(3)})</div>
                        </div>
                      </div>
                    )
                  })()
                ) : null}
              </div>
              <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6">
                <h2 className="mb-4 text-xl font-semibold text-slate-100">BIOMECHANICS</h2>
                {analysis && selectedPoseIndex ? (
                  (() => {
                    const pose = analysis.poses.find((p) => p.poseIndex === selectedPoseIndex) ?? null
                    if (!pose) return <p className="text-sm text-slate-400">Select a target player to calculate biomechanics.</p>
                    const bio = calculateBiomechanics(pose, canvasSize.width, canvasSize.height)
                    return (
                      <div className="space-y-3 text-sm text-slate-300">
                        <div className="flex items-center justify-between rounded-2xl bg-slate-900/70 px-4 py-3">
                          <span>Left Knee Flexion</span>
                          <strong>
                            {bio.leftKneeVisible ? `${bio.leftKneeAngle?.toFixed(1)}°` : <span className="text-rose-400">Low confidence</span>}
                          </strong>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-slate-900/70 px-4 py-3">
                          <span>Right Knee Flexion</span>
                          <strong>
                            {bio.rightKneeVisible ? `${bio.rightKneeAngle?.toFixed(1)}°` : <span className="text-rose-400">Low confidence</span>}
                          </strong>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-slate-900/70 px-4 py-3">
                          <span>Torso Lean</span>
                          <strong>{bio.torsoVisible ? `${bio.torsoLean?.toFixed(1)}°` : <span className="text-rose-400">Low confidence</span>}</strong>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-slate-900/70 px-4 py-3">
                          <span>Stance Width</span>
                          <strong>
                            {bio.stanceVisible ? `${bio.stanceRatio?.toFixed(2)}x shoulder width` : <span className="text-rose-400">Low confidence</span>}
                          </strong>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-slate-900/70 px-4 py-3">
                          <span>Shoulder Tilt</span>
                          <strong>{bio.shoulderTiltVisible ? `${bio.shoulderTilt?.toFixed(1)}°` : <span className="text-rose-400">Low confidence</span>}</strong>
                        </div>
                      </div>
                    )
                  })()
                ) : (
                  <p className="text-sm text-slate-400">Select a target player to calculate biomechanics.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
