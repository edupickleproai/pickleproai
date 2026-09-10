'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Send, Upload, Video } from 'lucide-react'
import { appendVideoBiomechanics } from '@/lib/coaching-biomechanics'

// Clean markdown artifacts from text
function cleanMarkdown(text: string): string {
  if (!text) return ''
  return text
    .replace(/\*\*/g, '')                     // Remove bold markers
    .replace(/###/g, '')                      // Remove heading markers
    .replace(/^[-•]\s*/gm, '')                // Remove bullet points at line start
    .replace(/^\d+\.\s*/gm, '')               // Remove numbered list markers
    .replace(/\n\s*\n/g, '\n')                // Remove extra blank lines
    .trim()
}

// Parse bullet points from text, removing markdown artifacts
function parseBulletPoints(text: string): string[] {
  if (!text) return []
  return text
    .split('\n')
    .map(line => line.replace(/^[-•]\s*/gm, '').replace(/^\d+\.\s*/gm, '').trim())
    .filter(line => line.length > 0)
}

type UserProfile = {
  name?: string
  skillLevel?: string
  dominantHand?: string
  playStyle?: string
  goals?: string[]
  weaknesses?: string[]
}

type VideoCategory = 'serve' | 'return' | 'dink' | 'volley' | 'footwork' | 'match-point' | 'general'

type TargetPlayerSelection =
  | 'auto-detect'
  | 'closest-camera'
  | 'farthest-camera'
  | 'left'
  | 'right'
  | 'red-green-shirt'
  | 'white-shirt'
  | 'manual'

type FramePreview = {
  label: string
  src: string
}

type AnnotatedFrame = FramePreview & {
  annotatedSrc?: string
  annotationError?: string
}

type ScoreBreakdown = {
  footwork: number
  positioning: number
  paddlePrep: number
  timing: number
  consistency: number
}

type Feedback = {
  diagnosis: string
  targetPlayerIdentified?: string
  readyPosition?: string
  contactPoint?: string
  recoveryStep?: string
  biggestIssue: string
  improveFirst: string
  drills: string[]
  score: number
  scoreBreakdown: ScoreBreakdown
  scoreExplanation: string
  frames?: FramePreview[]
}

async function createAnnotatedSrc(frame: FramePreview): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const scale = Math.min(960 / img.width, 1)
      const width = Math.round(img.width * scale)
      const height = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        reject(new Error('Canvas context not available'))
        return
      }

      ctx.imageSmoothingEnabled = true
      ctx.drawImage(img, 0, 0, width, height)

      const label = frame.label || 'Frame'
      const lowerLabel = label.toLowerCase()
      const centerX = width * 0.55
      const centerY = height * 0.45
      const highlightW = width * 0.24
      const highlightH = height * 0.36

      ctx.save()
      ctx.fillStyle = 'rgba(87,255,0,0.12)'
      ctx.strokeStyle = '#57FF00'
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.ellipse(centerX, centerY, highlightW, highlightH, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.restore()

      const textX = width * 0.08
      const textY = height * 0.15
      ctx.save()
      ctx.font = `600 ${Math.max(16, Math.round(width * 0.035))}px Inter, sans-serif`
      ctx.textBaseline = 'top'
      const text = lowerLabel.includes('contact')
        ? 'Good Contact Point'
        : lowerLabel.includes('ready')
        ? 'Ready Position'
        : lowerLabel.includes('recovery')
        ? 'Move Forward'
        : frame.label
      const metrics = ctx.measureText(text)
      const padding = 12
      ctx.fillStyle = 'rgba(0,0,0,0.75)'
      ctx.fillRect(textX - 10, textY - 8, metrics.width + padding, parseInt(ctx.font, 10) + padding)
      ctx.fillStyle = '#57FF00'
      ctx.fillText(text, textX, textY)
      ctx.restore()

      const drawArrow = (fromX: number, fromY: number, toX: number, toY: number, color: string) => {
        ctx.save()
        ctx.strokeStyle = color
        ctx.fillStyle = color
        ctx.lineWidth = 5
        ctx.setLineDash([10, 6])
        ctx.beginPath()
        ctx.moveTo(fromX, fromY)
        ctx.lineTo(toX, toY)
        ctx.stroke()
        const angle = Math.atan2(toY - fromY, toX - fromX)
        const headSize = 14
        ctx.beginPath()
        ctx.moveTo(toX, toY)
        ctx.lineTo(toX - headSize * Math.cos(angle - Math.PI / 6), toY - headSize * Math.sin(angle - Math.PI / 6))
        ctx.lineTo(toX - headSize * Math.cos(angle + Math.PI / 6), toY - headSize * Math.sin(angle + Math.PI / 6))
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      }

      if (lowerLabel.includes('contact')) {
        drawArrow(width * 0.12, height * 0.72, centerX, centerY + height * 0.05, '#57FF00')
      } else if (lowerLabel.includes('ready')) {
        drawArrow(width * 0.82, height * 0.22, centerX - width * 0.05, centerY - height * 0.02, '#57FF00')
      } else if (lowerLabel.includes('recovery')) {
        drawArrow(width * 0.18, height * 0.22, centerX - width * 0.1, centerY + height * 0.12, '#57FF00')
      } else {
        drawArrow(width * 0.1, height * 0.7, centerX - width * 0.06, centerY + height * 0.05, '#57FF00')
      }

      ctx.save()
      ctx.fillStyle = 'rgba(87,255,0,0.18)'
      ctx.strokeStyle = '#57FF00'
      ctx.lineWidth = 4
      const paddleX = width * 0.68
      const paddleY = height * 0.18
      const paddleW = width * 0.18
      const paddleH = height * 0.08
      ctx.fillRect(paddleX, paddleY, paddleW, paddleH)
      ctx.strokeRect(paddleX, paddleY, paddleW, paddleH)
      ctx.restore()

      ctx.save()
      ctx.font = `500 ${Math.max(14, Math.round(width * 0.025))}px Inter, sans-serif`
      ctx.fillStyle = '#57FF00'
      ctx.fillText('Paddle', paddleX + 10, paddleY + 10)
      ctx.restore()

      if (lowerLabel.includes('recovery') || lowerLabel.includes('footwork')) {
        ctx.save()
        ctx.fillStyle = 'rgba(255,69,0,0.16)'
        ctx.strokeStyle = '#FF4500'
        ctx.lineWidth = 5
        ctx.fillRect(width * 0.28, height * 0.7, width * 0.34, height * 0.16)
        ctx.strokeRect(width * 0.28, height * 0.7, width * 0.34, height * 0.16)
        ctx.restore()
        drawArrow(width * 0.48, height * 0.62, width * 0.48, height * 0.82, '#FF4500')
      }

      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }

    img.onerror = () => {
      reject(new Error('Failed to load frame image for annotation'))
    }

    img.src = frame.src
  })
}

// Parse structured coach response into sections
function normalizeVideoFeedback(raw: Partial<Feedback>): Feedback {
  const scoreBreakdown = {
    footwork: Number(raw.scoreBreakdown?.footwork ?? 0),
    positioning: Number(raw.scoreBreakdown?.positioning ?? 0),
    paddlePrep: Number(raw.scoreBreakdown?.paddlePrep ?? 0),
    timing: Number(raw.scoreBreakdown?.timing ?? 0),
    consistency: Number(raw.scoreBreakdown?.consistency ?? 0),
  }

  const validScores = Object.values(scoreBreakdown).filter((score) => score > 0)

  const score =
    validScores.length > 0
      ? Math.round(validScores.reduce((sum, score) => sum + score, 0) / validScores.length)
      : Number(raw.score ?? 0)

  return {
    diagnosis: raw.diagnosis || 'No technical diagnosis was returned.',
    targetPlayerIdentified: raw.targetPlayerIdentified || 'Target player could not be confidently identified.',
    readyPosition: raw.readyPosition || '',
    contactPoint: raw.contactPoint || '',
    recoveryStep: raw.recoveryStep || '',
    biggestIssue: raw.biggestIssue || 'No primary issue was returned.',
    improveFirst: raw.improveFirst || 'Focus on clean contact, balanced footwork, and faster recovery.',
    drills: Array.isArray(raw.drills) ? raw.drills : [],
    score,
    scoreBreakdown,
    scoreExplanation: raw.scoreExplanation || 'The score reflects the visible balance, positioning, paddle preparation, timing, and consistency shown in the analyzed frames.',
    frames: raw.frames || [],
  }
}

export default function VideoReviewPage() {
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [category, setCategory] = useState<VideoCategory>('general')
  const [notes, setNotes] = useState('')
  const [targetPlayerSelection, setTargetPlayerSelection] = useState<TargetPlayerSelection>('auto-detect')
  const [manualTargetDescription, setManualTargetDescription] = useState('')
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'error'>('idle')
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [annotatedFrames, setAnnotatedFrames] = useState<AnnotatedFrame[]>([])
  const [profile, setProfile] = useState<UserProfile>({ skillLevel: 'Intermediate', dominantHand: 'Right', playStyle: 'Balanced', goals: ['Improve consistency'], weaknesses: [] })

  const targetPlayerOptions: { value: TargetPlayerSelection; label: string }[] = [
    { value: 'auto-detect', label: 'Auto-detect from notes/video' },
    { value: 'closest-camera', label: 'Player closest to the camera' },
    { value: 'farthest-camera', label: 'Player farthest from the camera' },
    { value: 'left', label: 'Player on the left side of the frame' },
    { value: 'right', label: 'Player on the right side of the frame' },
    { value: 'red-green-shirt', label: 'Player in red/green shirt' },
    { value: 'white-shirt', label: 'Player in white shirt' },
    { value: 'manual', label: 'Other / describe manually' },
  ]

  const buildTargetPlayerDescription = () => {
    const trimmedManual = manualTargetDescription.trim()
    if (targetPlayerSelection === 'manual' && trimmedManual) {
      return trimmedManual
    }

    const selectionLabel = targetPlayerOptions.find((option) => option.value === targetPlayerSelection)?.label ?? 'Auto-detect from notes/video'
    if (notes.trim()) {
      return `${selectionLabel}. Use the user notes to identify the player: ${notes.trim()}`
    }

    return selectionLabel
  }

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('picklepro:user')
      if (saved) {
        const parsed = JSON.parse(saved) as UserProfile
        setProfile((prev) => ({ ...prev, ...parsed }))
      }
    } catch {
      // Storage may be unavailable or contain invalid JSON; keep defaults.
    }
  }, [])

  useEffect(() => {
    let active = true
    async function annotateFrames() {
      if (!feedback?.frames?.length) {
        setAnnotatedFrames([])
        return
      }

      const results = await Promise.all(
        feedback.frames.map(async (frame) => {
          try {
            const annotatedSrc = await createAnnotatedSrc(frame)
            return { ...frame, annotatedSrc }
          } catch {
            return { ...frame, annotationError: 'Annotation unavailable' }
          }
        })
      )

      if (active) {
        setAnnotatedFrames(results)
      }
    }

    annotateFrames()
    return () => {
      active = false
    }
  }, [feedback?.frames])

  const goalsText = useMemo(() => {
    if (!profile.goals?.length) return 'general improvement'
    return profile.goals.join(', ')
  }, [profile.goals])

  const weaknessesText = useMemo(() => {
    if (!profile.weaknesses?.length) return 'none specified'
    return profile.weaknesses.join(', ')
  }, [profile.weaknesses])

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && file.type.startsWith('video/')) {
      setVideoFile(file)
    }
  }

  const getAIFeedback = async () => {
    if (!notes.trim()) return

    setStatus('analyzing')
    setError('')
    setFeedback(null)

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 120000) // 2 minutes for video processing

    try {
      const formData = new FormData()
      if (videoFile) {
        formData.append('video', videoFile)
      }
      formData.append('category', category)
      formData.append('notes', notes.trim())
      formData.append('targetPlayerSelection', targetPlayerSelection)
      formData.append('targetPlayerDescription', buildTargetPlayerDescription())
      formData.append('userProfile', JSON.stringify(profile))
      const sentCoachingBiomechanics = videoFile
        ? appendVideoBiomechanics(formData, videoFile, () => window.localStorage)
        : null
      if (process.env.NODE_ENV !== 'production') {
        console.info('[dev] /api/video-analysis sanitized coaching biomechanics payload:', JSON.stringify(sentCoachingBiomechanics))
      }

      console.log("Sending video for analysis...")
      const response = await fetch('/api/video-analysis', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || `Analysis failed with status ${response.status}`)
      }

      if (!result.success || !result.analysis) {
        throw new Error('Analysis completed but no feedback was generated.')
      }

      setFeedback(normalizeVideoFeedback(result.analysis))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Video analysis failed.'
      console.error('Video analysis error:', err)
      setError(message)
    } finally {
      window.clearTimeout(timeoutId)
      setStatus('idle')
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await getAIFeedback()
  }

  const categories: { value: VideoCategory; label: string }[] = [
    { value: 'serve', label: 'Serve' },
    { value: 'return', label: 'Return' },
    { value: 'dink', label: 'Dink' },
    { value: 'volley', label: 'Volley' },
    { value: 'footwork', label: 'Footwork' },
    { value: 'match-point', label: 'Match Point' },
    { value: 'general', label: 'General Review' },
  ]

  return (
    <main className="min-h-screen bg-[#0B0F14] text-white">
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="relative w-full max-w-[800px] rounded-[2rem] border border-white/10 bg-[#0D1524]/[0.96] shadow-[0_40px_120px_-50px_rgba(24,166,100,0.45)] backdrop-blur-sm">
          <div className="border-b border-white/10 px-6 py-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Video Review</p>
                <h1 className="mt-3 text-3xl font-bold text-white">AI Visual Analysis</h1>
                <p className="mt-2 max-w-2xl text-slate-400">Upload your pickleball video and get AI-powered visual analysis of your technique, stance, and form.</p>
              </div>
              <div className="mt-4 flex flex-col gap-2 rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300 sm:mt-0">
                <span>Level: {profile.skillLevel ?? 'Intermediate'}</span>
                <span>Hand: {profile.dominantHand ?? 'Right'}</span>
                <span>Style: {profile.playStyle ?? 'Balanced'}</span>
                <span>Goals: {goalsText}</span>
                <span>Weaknesses: {weaknessesText}</span>
              </div>
            </div>
          </div>

          <div className="px-6 py-6">
            <div className="space-y-6">
              {/* Video Upload */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-slate-300">
                  Upload Video
                </label>
                <div className="relative">
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="flex items-center justify-center w-full h-32 border-2 border-dashed border-white/20 rounded-lg hover:border-white/40 transition-colors">
                    <div className="text-center">
                      {videoFile ? (
                        <div className="flex items-center gap-3">
                          <Video className="h-8 w-8 text-[#57FF00]" />
                          <div>
                            <p className="text-sm font-medium text-white">{videoFile.name}</p>
                            <p className="text-xs text-slate-400">{(videoFile.size / 1024 / 1024).toFixed(1)} MB</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2">
                          <Upload className="h-8 w-8 text-slate-400" />
                          <p className="text-sm text-slate-400">Click to upload video</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Category Selector */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-slate-300">
                  What type of shot/stroke is this?
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as VideoCategory)}
                  className="w-full px-3 py-2 bg-[#0B1321]/[0.95] border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[#57FF00]/50"
                >
                  {categories.map((cat) => (
                    <option key={cat.value} value={cat.value} className="bg-[#0B1321]">
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Target Player Selection */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-slate-300">
                  Which player should the AI analyze?
                </label>
                <select
                  value={targetPlayerSelection}
                  onChange={(e) => setTargetPlayerSelection(e.target.value as TargetPlayerSelection)}
                  className="w-full px-3 py-2 bg-[#0B1321]/[0.95] border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[#57FF00]/50"
                >
                  {targetPlayerOptions.map((option) => (
                    <option key={option.value} value={option.value} className="bg-[#0B1321]">
                      {option.label}
                    </option>
                  ))}
                </select>
                {targetPlayerSelection === 'manual' && (
                  <textarea
                    value={manualTargetDescription}
                    onChange={(e) => setManualTargetDescription(e.target.value)}
                    placeholder="Describe the target player: e.g., 'The player in the red shirt on the left side', 'The closer player with right-handed grip'"
                    rows={3}
                    className="w-full px-3 py-2 bg-[#0B1321]/[0.95] border border-white/10 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#57FF00]/50 resize-none"
                  />
                )}
              </div>

              {/* Notes */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-slate-300">
                  What do you want the AI coach to analyze?
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Describe what you want feedback on (e.g., 'My serve technique', 'Footwork during volleys', 'Dink consistency')"
                  rows={4}
                  className="w-full px-3 py-2 bg-[#0B1321]/[0.95] border border-white/10 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#57FF00]/50 resize-none"
                />
              </div>

              <button
                onClick={getAIFeedback}
                disabled={status === 'analyzing' || !notes.trim()}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#57FF00] text-[#07120c] font-semibold rounded-lg hover:bg-[#4ee100] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {status === 'analyzing' ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-[#07120c] border-t-transparent" />
                    Analyzing your technique...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Get AI Feedback
                  </>
                )}
              </button>

              {/* Error Message */}
              {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              {/* Feedback Display */}
              {feedback && (
                <div className="space-y-4 p-6 bg-[#111827]/[0.95] border border-white/10 rounded-lg">
                  {/* Header */}
                  <div className="flex items-center justify-between border-b border-white/10 pb-4">
                    <h3 className="text-lg font-semibold text-white">AI Visual Analysis</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-400">Overall Score:</span>
                      <div className={`px-3 py-1 rounded-full text-sm font-semibold ${
                        feedback.score >= 8 ? 'bg-green-500/20 text-green-400' :
                        feedback.score >= 6 ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {`${feedback.score}/10`}
                      </div>
                    </div>
                  </div>

                  {/* Score Breakdown Circles */}
                  {feedback.scoreBreakdown && (
                    <>
                      <div className="grid grid-cols-5 gap-2 p-4 bg-[#0B1321]/[0.85] border border-white/5 rounded-lg">
                        <div className="flex flex-col items-center">
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm ${
                            feedback.scoreBreakdown.footwork >= 8 ? 'bg-green-500/20 text-green-400' :
                            feedback.scoreBreakdown.footwork >= 6 ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-red-500/20 text-red-400'
                          }`}>
                            {feedback.scoreBreakdown.footwork}
                          </div>
                          <p className="text-[0.65rem] uppercase text-slate-400 mt-1 text-center tracking-wide">Footwork</p>
                        </div>
                        <div className="flex flex-col items-center">
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm ${
                            feedback.scoreBreakdown.positioning >= 8 ? 'bg-green-500/20 text-green-400' :
                            feedback.scoreBreakdown.positioning >= 6 ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-red-500/20 text-red-400'
                          }`}>
                            {feedback.scoreBreakdown.positioning}
                          </div>
                          <p className="text-[0.65rem] uppercase text-slate-400 mt-1 text-center tracking-wide">Position</p>
                        </div>
                        <div className="flex flex-col items-center">
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm ${
                            feedback.scoreBreakdown.paddlePrep >= 8 ? 'bg-green-500/20 text-green-400' :
                            feedback.scoreBreakdown.paddlePrep >= 6 ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-red-500/20 text-red-400'
                          }`}>
                            {feedback.scoreBreakdown.paddlePrep}
                          </div>
                          <p className="text-[0.65rem] uppercase text-slate-400 mt-1 text-center tracking-wide">Paddle</p>
                        </div>
                        <div className="flex flex-col items-center">
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm ${
                            feedback.scoreBreakdown.timing >= 8 ? 'bg-green-500/20 text-green-400' :
                            feedback.scoreBreakdown.timing >= 6 ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-red-500/20 text-red-400'
                          }`}>
                            {feedback.scoreBreakdown.timing}
                          </div>
                          <p className="text-[0.65rem] uppercase text-slate-400 mt-1 text-center tracking-wide">Timing</p>
                        </div>
                        <div className="flex flex-col items-center">
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm ${
                            feedback.scoreBreakdown.consistency >= 8 ? 'bg-green-500/20 text-green-400' :
                            feedback.scoreBreakdown.consistency >= 6 ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-red-500/20 text-red-400'
                          }`}>
                            {feedback.scoreBreakdown.consistency}
                          </div>
                          <p className="text-[0.65rem] uppercase text-slate-400 mt-1 text-center tracking-wide">Const.</p>
                        </div>
                      </div>

                      {feedback.scoreExplanation && (
                        <div className="space-y-3 rounded-xl border border-white/10 bg-[#0B1321]/[0.85] p-4">
                          <h4 className="font-semibold text-[#57FF00] text-sm uppercase tracking-wider mb-3">Score Explanation</h4>
                          <ul className="text-slate-200 text-sm space-y-2 leading-relaxed">
                            {parseBulletPoints(feedback.scoreExplanation).map((line, idx) => (
                              <li key={idx} className="flex items-start gap-2">
                                <span className="text-[#57FF00] mt-0.5 flex-shrink-0">•</span>
                                <span className="flex-1">{line}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}

                  {/* Target Player Analysis */}
                  {(feedback.targetPlayerIdentified || feedback.readyPosition || feedback.contactPoint || feedback.recoveryStep) && (
                    <div className="space-y-4 rounded-xl border border-white/10 bg-[#0B1321]/[0.85] p-4">
                      <h4 className="font-semibold text-[#57FF00] text-sm uppercase tracking-wider mb-3">Target Player Analysis</h4>
                      {(feedback.targetPlayerIdentified || feedback.readyPosition || feedback.contactPoint || feedback.recoveryStep) && (
                        <div>
                          <p className="text-slate-300 text-sm font-semibold">Player Identified</p>
                          <p className="text-slate-200 text-sm leading-relaxed mt-2">{cleanMarkdown(feedback.targetPlayerIdentified)}</p>
                        </div>
                      )}
                      {feedback.readyPosition && (
                        <div>
                          <p className="text-slate-300 text-sm font-semibold">Ready Position</p>
                          <p className="text-slate-200 text-sm leading-relaxed mt-2">{cleanMarkdown(feedback.readyPosition)}</p>
                        </div>
                      )}
                      {feedback.contactPoint && (
                        <div>
                          <p className="text-slate-300 text-sm font-semibold">Contact Point</p>
                          <p className="text-slate-200 text-sm leading-relaxed mt-2">{cleanMarkdown(feedback.contactPoint)}</p>
                        </div>
                      )}
                      {feedback.recoveryStep && (
                        <div>
                          <p className="text-slate-300 text-sm font-semibold">Recovery Step</p>
                          <p className="text-slate-200 text-sm leading-relaxed mt-2">{cleanMarkdown(feedback.recoveryStep)}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Technical Diagnosis */}
                  {feedback.diagnosis && (
                    <div>
                      <h4 className="font-semibold text-[#57FF00] text-sm uppercase tracking-wider mb-3">Technical Diagnosis</h4>
                      <div className="text-slate-200 text-sm leading-relaxed space-y-3">
                        {feedback.diagnosis.split('\n\n').map((section, idx) => {
                          const cleaned = cleanMarkdown(section.trim())
                          if (cleaned.match(/^(Ready Position|Contact Point|Recovery Step|Strength|Weakness|Correction):/i)) {
                            const [label, ...rest] = cleaned.split(': ')
                            return (
                              <div key={idx}>
                                <p className="font-semibold text-[#57FF00]">{label}:</p>
                                <p className="text-slate-300 mt-1">{rest.join(': ')}</p>
                              </div>
                            )
                          }
                          return <p key={idx}>{cleaned}</p>
                        })}
                      </div>
                    </div>
                  )}

                  {/* Biggest Issue */}
                  {feedback.biggestIssue && (
                    <div>
                      <h4 className="font-semibold text-[#57FF00] text-sm uppercase tracking-wider mb-3">Biggest Issue</h4>
                      <div className="text-slate-200 text-sm leading-relaxed">
                        <p>{cleanMarkdown(feedback.biggestIssue)}</p>
                      </div>
                    </div>
                  )}

                  {/* What to Improve First */}
                  {feedback.improveFirst && (
                    <div>
                      <h4 className="font-semibold text-[#57FF00] text-sm uppercase tracking-wider mb-3">What to Improve First</h4>
                      <div className="text-slate-200 text-sm leading-relaxed">
                        <p>{cleanMarkdown(feedback.improveFirst)}</p>
                      </div>
                    </div>
                  )}

                  {/* Recommended Drills */}
                  {feedback.drills.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-[#57FF00] text-sm uppercase tracking-wider mb-3">Recommended Drills</h4>
                      <ul className="text-slate-200 text-sm space-y-2">
                        {feedback.drills.map((drill, index) => (
                          <li key={index} className="flex items-start gap-2">
                            <span className="text-[#57FF00] mt-0.5 flex-shrink-0">•</span>
                            <div className="flex-1">
                              <p>{cleanMarkdown(drill)}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {feedback.frames?.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-[#57FF00] text-sm uppercase tracking-wider mb-4">Analyzed Frames</h4>
                      <div className="space-y-4">
                        {((annotatedFrames.length ? annotatedFrames : feedback.frames) as AnnotatedFrame[]).map((frame) => (
                          <div key={frame.label} className="grid gap-4 rounded-[1.5rem] border border-white/10 bg-[#091014]/[0.85] p-4 shadow-[0_20px_80px_-50px_rgba(87,255,0,0.45)] sm:grid-cols-2">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[0.65rem] uppercase tracking-[0.22em] text-slate-400">Original Frame</span>
                                <span className="text-[0.65rem] font-semibold text-[#57FF00] uppercase tracking-[0.22em]">{frame.label}</span>
                              </div>
                              <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#081013]">
                                <img
                                  src={frame.src}
                                  alt={`Original ${frame.label}`}
                                  className="h-64 w-full object-cover"
                                  loading="lazy"
                                />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[0.65rem] uppercase tracking-[0.22em] text-slate-400">Annotated Frame</span>
                                {frame.annotationError ? (
                                  <span className="text-[0.65rem] text-red-400">Annotation unavailable</span>
                                ) : null}
                              </div>
                              <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#081013]">
                                {frame.annotatedSrc ? (
                                  <img
                                    src={frame.annotatedSrc}
                                    alt={`Annotated ${frame.label}`}
                                    className="h-64 w-full object-cover"
                                    loading="lazy"
                                  />
                                ) : (
                                  <div className="flex h-64 items-center justify-center px-4 text-center text-sm text-slate-400">
                                    Annotation not available for this frame.
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Coming Soon Note */}
              <div className="text-center py-4">
                <p className="text-xs text-slate-500 italic">
                  AI visual analysis is experimental. Results may vary based on video quality and lighting.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
