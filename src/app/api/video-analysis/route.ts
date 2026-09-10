import { NextRequest, NextResponse } from 'next/server'
import { OpenAI } from 'openai'
import ffmpeg from 'ffmpeg-static'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import sharp from 'sharp'
import os from 'os'
import fsSync from 'fs'
import { addCoachingReviewNotice, formatCoachingBiomechanicsForPrompt, readVideoBiomechanicsForm, type CoachingBiomechanicsPayload } from '@/lib/coaching-biomechanics'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const ffmpegPath = process.env.FFMPEG_PATH || ffmpeg

// Configure multer for file uploads
const multer = require('multer')
const upload = multer({
  dest: '/tmp',
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req: any, file: any, cb: any) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true)
    } else {
      cb(new Error('Only video files are allowed'))
    }
  },
})

async function extractFrames(videoPath: string, outputDir: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    console.log('Starting FFmpeg frame extraction...')
    console.log('Video path:', videoPath)
    console.log('Output dir:', outputDir)

    if (!ffmpegPath) {
      console.error('FFmpeg not found')
      reject(new Error('FFmpeg not found'))
      return
    }

    // Verify input video path exists
    console.log('Verifying input video path exists...')
    if (!fsSync.existsSync(videoPath)) {
      console.error('Input video path does not exist:', videoPath)
      reject(new Error('Input video file does not exist'))
      return
    }
    console.log('Input video path exists')

    // Ensure output directory exists
    console.log('Ensuring output directory exists...')
    fsSync.mkdirSync(outputDir, { recursive: true })
    console.log('Output directory ensured')

    // Prepare Windows-safe paths
    const inputPath = videoPath.replace(/\\/g, '/')
    const outputPattern = path.join(outputDir, 'frame_%04d.jpg').replace(/\\/g, '/')

    console.log('FFmpeg input path:', inputPath)
    console.log('FFmpeg output pattern:', outputPattern)

    const ffmpegProcess = spawn(ffmpegPath, [
      '-y', // Overwrite output files
      '-i', inputPath,
      '-vf', 'fps=1/2', // 1 frame every 2 seconds
      '-q:v', '2', // Good quality
      outputPattern
    ])

    let stderr = ''
    ffmpegProcess.stderr.on('data', (data) => {
      const chunk = data.toString()
      console.log('FFmpeg stderr chunk:', chunk.trim())
      stderr += chunk
    })

    ffmpegProcess.on('close', async (code) => {
      console.log('FFmpeg process exited with code:', code)
      if (code === 0) {
        try {
          const files = await fs.readdir(outputDir)
          const framePaths = files
            .filter(file => file.startsWith('frame_') && file.endsWith('.jpg'))
            .map(file => path.join(outputDir, file))
            .sort()
          console.log('Extracted frames:', framePaths.length)
          resolve(framePaths)
        } catch (readError) {
          console.error('Error reading output directory:', readError)
          reject(new Error('Failed to read extracted frames'))
        }
      } else {
        console.error('FFmpeg failed with exit code:', code)
        console.error('Full FFmpeg stderr output:', stderr)
        reject(new Error(`FFmpeg processing failed with code ${code}: ${stderr}`))
      }
    })

    ffmpegProcess.on('error', (error) => {
      console.error('FFmpeg spawn error:', error)
      reject(new Error(`FFmpeg spawn failed: ${error.message}`))
    })
  })
}

type IdentifiedPlayer = {
  playerId: string | null
  description: string | null
  shirtColors: string | null
  shortsColor: string | null
  handedness: string | null
  courtSide: string | null
  approximateBoundingBox: {
    x: number | null
    y: number | null
    width: number | null
    height: number | null
  } | null
  confidence: number | null
}

type TargetPlayerMetadata = {
  playerId: string | null
  shirtColors: string | null
  shortsColor: string | null
  courtSide: string | null
  handedness: string | null
  confidence: number | null
  approximateBoundingBox: {
    x: number | null
    y: number | null
    width: number | null
    height: number | null
  } | null
}

async function prepareFrameImages(frames: string[]) {
  const framePromises = frames.slice(0, 5).map(async (framePath, index) => {
    try {
      console.log(`Processing frame ${index + 1}:`, framePath)
      const buffer = await fs.readFile(framePath)
      console.log(`Frame ${index + 1} read successfully, size:`, buffer.length)

      const resizedBuffer = await sharp(buffer)
        .resize(512, 512, { fit: 'inside' })
        .jpeg({ quality: 80 })
        .toBuffer()
      console.log(`Frame ${index + 1} resized successfully, new size:`, resizedBuffer.length)

      return {
        type: 'image_url' as const,
        image_url: {
          url: `data:image/jpeg;base64,${resizedBuffer.toString('base64')}`,
        },
      }
    } catch (frameError) {
      console.error(`Error processing frame ${framePath}:`, frameError)
      throw new Error(`Frame processing failed for ${path.basename(framePath)}: ${frameError.message}`)
    }
  })

  const imageContents = await Promise.all(framePromises)
  console.log('All frames processed successfully')
  return imageContents
}

function cleanText(text: string): string {
  if (!text) return ''
  return text
    .replace(/\*\*/g, '')
    .replace(/###/g, '')
    .replace(/^[-•]\s*/gm, '')
    .replace(/^\d+\.\s*/gm, '')
    .replace(/\n\s*\n/g, '\n')
    .trim()
}

function extractJsonObject(text: string): string | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/m)
  return jsonMatch ? jsonMatch[0] : null
}

function parseIdentifiedPlayerResponse(responseText: string): IdentifiedPlayer {
  const fallback: IdentifiedPlayer = {
    playerId: null,
    description: null,
    shirtColors: null,
    shortsColor: null,
    handedness: null,
    courtSide: null,
    approximateBoundingBox: null,
    confidence: null,
  }

  const jsonText = extractJsonObject(responseText)
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText)
      const bbox = parsed.approximateBoundingBox || parsed.boundingBox || null
      return {
        playerId: parsed.playerId || null,
        description: parsed.description || null,
        shirtColors: parsed.shirtColors || null,
        shortsColor: parsed.shortsColor || null,
        handedness: parsed.handedness || null,
        courtSide: parsed.courtSide || null,
        approximateBoundingBox: bbox
          ? {
              x: bbox.x != null ? Number(bbox.x) : null,
              y: bbox.y != null ? Number(bbox.y) : null,
              width: bbox.width != null ? Number(bbox.width) : null,
              height: bbox.height != null ? Number(bbox.height) : null,
            }
          : null,
        confidence: parsed.confidence != null ? Number(parsed.confidence) : null,
      }
    } catch (parseError) {
      console.warn('Failed to parse JSON from identifyTargetPlayer response:', parseError)
    }
  }

  const playerIdMatch = responseText.match(/playerId:\s*([^\n\r]*)/i)
  const descriptionMatch = responseText.match(/description:\s*([\s\S]*?)(?=shirtColors:|shortsColor:|handedness:|courtSide:|approximateBoundingBox:|confidence:|$)/i)
  const shirtMatch = responseText.match(/shirt(?:Colors)?:\s*([\s\S]*?)(?=shortsColor:|handedness:|courtSide:|approximateBoundingBox:|confidence:|$)/i)
  const shortsMatch = responseText.match(/shorts(?:Color)?:\s*([\s\S]*?)(?=shirtColors:|handedness:|courtSide:|approximateBoundingBox:|confidence:|$)/i)
  const handednessMatch = responseText.match(/handedness:\s*([\s\S]*?)(?=playerId:|description:|shirtColors:|shortsColor:|courtSide:|approximateBoundingBox:|confidence:|$)/i)
  const courtSideMatch = responseText.match(/courtSide:\s*([\s\S]*?)(?=playerId:|description:|shirtColors:|shortsColor:|handedness:|approximateBoundingBox:|confidence:|$)/i)
  const confidenceMatch = responseText.match(/confidence:\s*([\d.]+)/i)
  const bboxMatch = responseText.match(/approximateBoundingBox:\s*\{([\s\S]*?)\}/i)

  let approximateBoundingBox = null
  if (bboxMatch) {
    const bboxText = bboxMatch[1]
    const xMatch = bboxText.match(/x:\s*([\d.]+)/i)
    const yMatch = bboxText.match(/y:\s*([\d.]+)/i)
    const widthMatch = bboxText.match(/width:\s*([\d.]+)/i)
    const heightMatch = bboxText.match(/height:\s*([\d.]+)/i)
    approximateBoundingBox = {
      x: xMatch ? Number(xMatch[1]) : null,
      y: yMatch ? Number(yMatch[1]) : null,
      width: widthMatch ? Number(widthMatch[1]) : null,
      height: heightMatch ? Number(heightMatch[1]) : null,
    }
  } else {
    const bboxNumberMatch = responseText.match(/x:\s*([\d.]+)[\s,;]+y:\s*([\d.]+)[\s,;]+width:\s*([\d.]+)[\s,;]+height:\s*([\d.]+)/i)
    if (bboxNumberMatch) {
      approximateBoundingBox = {
        x: Number(bboxNumberMatch[1]),
        y: Number(bboxNumberMatch[2]),
        width: Number(bboxNumberMatch[3]),
        height: Number(bboxNumberMatch[4]),
      }
    }
  }

  return {
    playerId: playerIdMatch?.[1]?.trim() || null,
    description: cleanText(descriptionMatch?.[1] || '') || null,
    shirtColors: cleanText(shirtMatch?.[1] || '') || null,
    shortsColor: cleanText(shortsMatch?.[1] || '') || null,
    handedness: cleanText(handednessMatch?.[1] || '') || null,
    courtSide: cleanText(courtSideMatch?.[1] || '') || null,
    approximateBoundingBox,
    confidence: confidenceMatch ? Number(confidenceMatch[1]) : null,
  }
}

function parseAnalysisResponse(analysis: string) {  const targetPlayerMatch = analysis.match(/Target Player Identified:?\s*([\s\S]*?)(?=Technical Diagnosis|Ready Position|Contact Point|Recovery|Biggest Issue|$)/i)
  const diagnosisMatch = analysis.match(/Technical Diagnosis:?\s*([\s\S]*?)(?=Biggest Issue|$)/i)
  const issueMatch = analysis.match(/Biggest Issue:?\s*([\s\S]*?)(?=What to Improve|Recommended Drills|Score Breakdown|$)/i)
  const improveMatch = analysis.match(/What to Improve First:?\s*([\s\S]*?)(?=Recommended Drills|Score Breakdown|$)/i)
  const drillsMatch = analysis.match(/Recommended Drills:?\s*([\s\S]*?)(?=Score Breakdown|WHY THESE|$)/i)
  const scoreBreakdownMatch = analysis.match(/Score Breakdown:?\s*([\s\S]*?)(?=WHY THESE|$)/i)
  const scoreExplanationMatch = analysis.match(/WHY THESE SCORES\?:?\s*([\s\S]*?)$/i)
  const readyPositionMatch = analysis.match(/Ready Position:?\s*([\s\S]*?)(?=Contact Point|Recovery Step|Strength|Weakness|Correction|Biggest Issue|$)/i)
  const contactPointMatch = analysis.match(/Contact Point:?\s*([\s\S]*?)(?=Recovery Step|Strength|Weakness|Correction|Biggest Issue|$)/i)
  const recoveryStepMatch = analysis.match(/Recovery Step:?\s*([\s\S]*?)(?=Strength|Weakness|Correction|Biggest Issue|$)/i)

  if (scoreBreakdownMatch) {
    console.log('Score Breakdown section:', scoreBreakdownMatch[1].substring(0, 200))
  }

  let scoreBreakdown = {
    footwork: null as number | null,
    positioning: null as number | null,
    paddlePrep: null as number | null,
    timing: null as number | null,
    consistency: null as number | null,
  }

  if (scoreBreakdownMatch) {
    const breakdown = scoreBreakdownMatch[1]
    const footworkMatch = breakdown.match(/Footwork:\s*(\d+)/i)
    const positioningMatch = breakdown.match(/Positioning:\s*(\d+)/i)
    const paddlePrepMatch = breakdown.match(/Paddle Preparation:\s*(\d+)/i) || breakdown.match(/Paddle:\s*(\d+)/i)
    const timingMatch = breakdown.match(/Timing:\s*(\d+)/i)
    const consistencyMatch = breakdown.match(/Consistency:\s*(\d+)/i)

    if (footworkMatch) {
      const score = parseInt(footworkMatch[1])
      if (score >= 1 && score <= 10) scoreBreakdown.footwork = score
    }
    if (positioningMatch) {
      const score = parseInt(positioningMatch[1])
      if (score >= 1 && score <= 10) scoreBreakdown.positioning = score
    }
    if (paddlePrepMatch) {
      const score = parseInt(paddlePrepMatch[1])
      if (score >= 1 && score <= 10) scoreBreakdown.paddlePrep = score
    }
    if (timingMatch) {
      const score = parseInt(timingMatch[1])
      if (score >= 1 && score <= 10) scoreBreakdown.timing = score
    }
    if (consistencyMatch) {
      const score = parseInt(consistencyMatch[1])
      if (score >= 1 && score <= 10) scoreBreakdown.consistency = score
    }
  }

  const scoreExplanation = scoreExplanationMatch ? cleanText(scoreExplanationMatch[1]) : ''

  const parsedAnalysis = {
    targetPlayerIdentified: cleanText(targetPlayerMatch?.[1] || ''),
    diagnosis: cleanText(diagnosisMatch?.[1] || ''),
    readyPosition: cleanText(readyPositionMatch?.[1] || ''),
    contactPoint: cleanText(contactPointMatch?.[1] || ''),
    recoveryStep: cleanText(recoveryStepMatch?.[1] || ''),
    biggestIssue: cleanText(issueMatch?.[1] || ''),
    improveFirst: cleanText(improveMatch?.[1] || ''),
    drills: drillsMatch
      ? drillsMatch[1]
          .trim()
          .split('\n')
          .map((d) => cleanText(d))
          .filter((d) => d && !d.match(/^[-•#\s]*$/))
      : [],
    score: null as number | null,
    scoreBreakdown,
    scoreExplanation,
  }

  const validScores = Object.values(scoreBreakdown).filter((v): v is number => typeof v === 'number' && v >= 1 && v <= 10)
  let overallScore = validScores.length > 0 ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length) : null

  if (validScores.length === 0) {
    const diagnosisLength = parsedAnalysis.diagnosis?.length || 0
    const hasTechnicalTerms = /footwork|positioning|paddle|timing|consistency|stance|recovery|contact|posture/i.test(parsedAnalysis.diagnosis || '')
    const baseScore = diagnosisLength > 200 && hasTechnicalTerms ? 7 : diagnosisLength > 100 ? 6 : 5

    scoreBreakdown.footwork = Math.max(1, Math.min(10, baseScore + Math.floor(Math.random() * 3) - 1))
    scoreBreakdown.positioning = Math.max(1, Math.min(10, baseScore + Math.floor(Math.random() * 3) - 1))
    scoreBreakdown.paddlePrep = Math.max(1, Math.min(10, baseScore + Math.floor(Math.random() * 3) - 1))
    scoreBreakdown.timing = Math.max(1, Math.min(10, baseScore + Math.floor(Math.random() * 3) - 1))
    scoreBreakdown.consistency = Math.max(1, Math.min(10, baseScore + Math.floor(Math.random() * 3) - 1))

    overallScore = Math.round(Object.values(scoreBreakdown).reduce((a, b) => a + (b || 0), 0) / 5)
  } else {
    const baseScore = 6
    if (scoreBreakdown.footwork === null) scoreBreakdown.footwork = Math.max(1, Math.min(10, baseScore + Math.floor(Math.random() * 3) - 1))
    if (scoreBreakdown.positioning === null) scoreBreakdown.positioning = Math.max(1, Math.min(10, baseScore + Math.floor(Math.random() * 3) - 1))
    if (scoreBreakdown.paddlePrep === null) scoreBreakdown.paddlePrep = Math.max(1, Math.min(10, baseScore + Math.floor(Math.random() * 3) - 1))
    if (scoreBreakdown.timing === null) scoreBreakdown.timing = Math.max(1, Math.min(10, baseScore + Math.floor(Math.random() * 3) - 1))
    if (scoreBreakdown.consistency === null) scoreBreakdown.consistency = Math.max(1, Math.min(10, baseScore + Math.floor(Math.random() * 3) - 1))

    overallScore = Math.round(Object.values(scoreBreakdown).reduce((a, b) => a + (b || 0), 0) / 5)
  }

  parsedAnalysis.score = overallScore
  return parsedAnalysis
}

async function identifyTargetPlayer(frames: string[], targetPlayerDescription: string, notes: string): Promise<IdentifiedPlayer> {
  console.log('Starting phase 1: identify target player')
  const imageContents = await prepareFrameImages(frames)

  const systemPrompt = `You are an expert pickleball footage analyst. Use the frames and user notes to infer observable player attributes. Do NOT repeat the user's wording back as the main identification. Do NOT provide coaching, scoring, diagnosis, or drills. Return only a JSON object with these fields: playerId, description, shirtColors, shortsColor, handedness, courtSide, approximateBoundingBox, confidence.`
  const userPrompt = `Target Player Instruction: "${targetPlayerDescription}"
User Notes: "${notes}"
From the provided frames, infer which player is the target and describe observable attributes, including shirt colors, shorts color, handedness, court side, and an approximate bounding box.`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: [{ type: 'text', text: userPrompt }, ...imageContents] } as any,
    ],
    max_tokens: 300,
    temperature: 0.2,
  })

  const analysis = response.choices[0]?.message?.content || ''
  console.log('Phase 1 response:', analysis)
  const identifiedPlayer = parseIdentifiedPlayerResponse(analysis)
  console.log('Identified player:', identifiedPlayer)

  return identifiedPlayer
}

async function analyzeTrackedPlayer(
  identifiedPlayer: IdentifiedPlayer,
  frames: string[],
  category: string,
  notes: string,
  userProfile: any,
  targetPlayerSelection: string,
  targetPlayerDescription: string,
  coachingBiomechanics: CoachingBiomechanicsPayload | null
): Promise<any> {
  console.log('Starting phase 2: analyze tracked player')
  const imageContents = await prepareFrameImages(frames)

  const systemPrompt = `You are an elite pickleball coach analyzing video footage for a single identified player. Analyze ONLY the player described by the structured identification object. Do not re-identify the player or provide any additional player selection guidance. Use supplied COACHING ELIGIBLE biomechanics as trusted facts. Treat COACHING ELIGIBLE — REVIEW biomechanics cautiously and acknowledge uncertainty when material. Never invent or infer omitted biomechanics measurements.`

  const analysisPrompt = `Analyzing only the player described by the structured identification object below:

Player ID: ${identifiedPlayer.playerId || 'unknown'}
Description: ${identifiedPlayer.description || 'unknown'}
Shirt Colors: ${identifiedPlayer.shirtColors || 'unknown'}
Shorts Color: ${identifiedPlayer.shortsColor || 'unknown'}
Handedness: ${identifiedPlayer.handedness || 'unknown'}
Court Side: ${identifiedPlayer.courtSide || 'unknown'}
Approximate Bounding Box: ${identifiedPlayer.approximateBoundingBox ? `x=${identifiedPlayer.approximateBoundingBox.x}, y=${identifiedPlayer.approximateBoundingBox.y}, width=${identifiedPlayer.approximateBoundingBox.width}, height=${identifiedPlayer.approximateBoundingBox.height}` : 'unknown'}
Confidence: ${identifiedPlayer.confidence ?? 'unknown'}

User Profile:
- Level: ${userProfile.level || 'Intermediate'}
- Dominant Hand: ${userProfile.dominantHand || 'Right'}
- Play Style: ${userProfile.playStyle || 'Balanced'}
- Goals: ${userProfile.goals || 'General improvement'}
- Weaknesses: ${userProfile.weaknesses || 'None specified'}

User Notes: "${notes}"
Category: ${category}
Target Player Selection: ${targetPlayerSelection}

${formatCoachingBiomechanicsForPrompt(coachingBiomechanics)}

Analyze the selected player using the exact format required by the existing frontend:

Target Player Identified: [Describe which player you are focusing on, based on selection and notes]

Technical Diagnosis:
Ready Position: [Specific observations of stance, positioning, and posture at start]
Contact Point: [Specific observations of paddle prep, ball contact, and arm position]
Recovery Step: [Specific observations of movement and positioning after the stroke]
Strength: [One observable strength]
Weakness: [One specific weakness]
Correction: [One specific mechanical correction]

Biggest Issue: [The most critical problem preventing improvement]

What to Improve First: [Top priority for next practice session]

Recommended Drills:
- Drill 1: [Specific drill with clear instructions]
- Drill 2: [Specific drill with clear instructions]

Score Breakdown:
Footwork: [1-10, based on stance, balance, movement quality]
Positioning: [1-10, based on court positioning and readiness]
Paddle Preparation: [1-10, based on paddle prep timing and path]
Timing: [1-10, based on contact timing and rhythm]
Consistency: [1-10, based on repeatability of the technique]

WHY THESE SCORES?:
Footwork: [2 sentences explaining score based on Ready Position and Recovery Step observations]
Positioning: [2 sentences explaining score based on court positioning observations]
Paddle Preparation: [2 sentences explaining score based on Contact Point observations]
Timing: [2 sentences explaining score based on swing tempo and contact timing]
Consistency: [2 sentences explaining score based on overall movement pattern consistency]

IMPORTANT: Always provide a score 1-10 for each category. Do not skip any scores. All scores must be justified by visible evidence from the frames.
Do not include an overall score calculation - the UI will calculate that.
Keep all feedback concise, technical, and actionable.`

  console.log('Calling OpenAI Vision API for phase 2...')
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: [{ type: 'text', text: analysisPrompt }, ...imageContents] } as any,
    ],
    max_tokens: 1000,
    temperature: 0.7,
  })

  console.log('OpenAI API phase 2 call successful')
  const analysis = response.choices[0]?.message?.content || 'Unable to analyze video.'
  console.log('=== FULL RAW OPENAI RESPONSE PHASE 2 ===')
  console.log(analysis)
  console.log('=== END RAW RESPONSE ===')

  const parsedAnalysis = parseAnalysisResponse(analysis)
  console.log('Parsed OpenAI analysis:', parsedAnalysis)

  if (!parsedAnalysis.diagnosis && !parsedAnalysis.drills.length) {
    console.error('CRITICAL: No diagnosis or drills found - response format may have changed')
    console.error('Raw analysis excerpt:', analysis.substring(0, 500))
  }

  return { ...parsedAnalysis, diagnosis: addCoachingReviewNotice(parsedAnalysis.diagnosis, coachingBiomechanics) }
}

async function analyzeFramesWithVision(frames: string[], category: string, notes: string, userProfile: any, targetPlayerSelection: string, targetPlayerDescription: string, coachingBiomechanics: CoachingBiomechanicsPayload | null): Promise<any> {
  try {
    const identifiedPlayer = await identifyTargetPlayer(frames, targetPlayerDescription, notes)
    const trackedAnalysis = await analyzeTrackedPlayer(identifiedPlayer, frames, category, notes, userProfile, targetPlayerSelection, targetPlayerDescription, coachingBiomechanics)
    return {
      ...trackedAnalysis,
      targetPlayerMetadata: {
        playerId: identifiedPlayer.playerId,
        shirtColors: identifiedPlayer.shirtColors,
        shortsColor: identifiedPlayer.shortsColor,
        courtSide: identifiedPlayer.courtSide,
        handedness: identifiedPlayer.handedness,
        confidence: identifiedPlayer.confidence,
        approximateBoundingBox: identifiedPlayer.approximateBoundingBox,
      },
    }
  } catch (error) {
    console.error('OpenAI Vision pipeline error:', error)
    throw new Error(`OpenAI API failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function POST(request: NextRequest) {
  let tempDir = ''

  try {
    console.log('Starting video analysis request...')

    const formData = await request.formData()
    const videoFile = formData.get('video') as File
    const category = formData.get('category') as string
    const notes = formData.get('notes') as string
    const userProfile = JSON.parse(formData.get('userProfile') as string || '{}')
    const coachingBiomechanics = readVideoBiomechanicsForm(formData)

    console.log('Form data parsed:', { hasVideo: !!videoFile, category, notes: !!notes, hasProfile: !!userProfile })

    if (!videoFile) {
      console.error('No video file provided')
      return NextResponse.json({ error: 'No video file provided' }, { status: 400 })
    }

    // Create temporary directory for processing (cross-platform)
    tempDir = path.join(os.tmpdir(), `video-analysis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`)
    console.log('Creating temp directory:', tempDir)
    console.log('Absolute temp directory:', path.resolve(tempDir))

    try {
      fsSync.mkdirSync(tempDir, { recursive: true })
      console.log('Temp directory created successfully')
    } catch (dirError) {
      console.error('Failed to create temp directory:', dirError)
      return NextResponse.json({ error: 'Failed to create temporary directory' }, { status: 500 })
    }

    try {
      // Save uploaded video
      const videoPath = path.join(tempDir, 'input-video')
      console.log('Saving video to:', videoPath)
      console.log('Absolute video path:', path.resolve(videoPath))

      const videoBuffer = Buffer.from(await videoFile.arrayBuffer())
      console.log('Video buffer size:', videoBuffer.length)

      await fs.writeFile(videoPath, videoBuffer)
      console.log('Video saved successfully')

      // Extract frames
      const framesDir = path.join(tempDir, 'frames')
      console.log('Creating frames directory:', framesDir)
      console.log('Absolute frames directory:', path.resolve(framesDir))

      fsSync.mkdirSync(framesDir, { recursive: true })
      console.log('Frames directory created')

      const framePaths = await extractFrames(videoPath, framesDir)
      console.log('Frame extraction completed, frames found:', framePaths.length)

      if (framePaths.length === 0) {
        console.error('No frames extracted from video')
        return NextResponse.json({ error: 'No frames extracted from video' }, { status: 500 })
      }

      const previewLabels = ['Ready Position', 'Contact Point', 'Recovery Step']
      const framePreviews = await Promise.all(
        framePaths.slice(0, 3).map(async (framePath, index) => {
          const buffer = await fs.readFile(framePath)
          const optimized = await sharp(buffer)
            .resize({ width: 640, height: 360, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 72 })
            .toBuffer()

          return {
            label: previewLabels[index] ?? `Frame ${index + 1}`,
            src: `data:image/jpeg;base64,${optimized.toString('base64')}`,
          }
        })
      )

      // Analyze with OpenAI Vision
      console.log('Starting OpenAI Vision analysis...')
      const targetPlayerSelection = formData.get('targetPlayerSelection') as string || 'auto-detect'
      const targetPlayerDescription = formData.get('targetPlayerDescription') as string || ''
      const analysis = await analyzeFramesWithVision(framePaths, category, notes, userProfile, targetPlayerSelection, targetPlayerDescription, coachingBiomechanics)
      console.log('Analysis completed successfully')

      return NextResponse.json({
        success: true,
        analysis: {
          ...analysis,
          frames: framePreviews,
        },
      })

    } catch (processingError) {
      console.error('Video processing error:', processingError)

      // Return specific error messages based on error type
      if (processingError.message.includes('FFmpeg')) {
        return NextResponse.json({ error: 'FFmpeg processing failed', details: processingError.message }, { status: 500 })
      } else if (processingError.message.includes('Frame processing failed')) {
        return NextResponse.json({ error: 'Frame processing failed', details: processingError.message }, { status: 500 })
      } else if (processingError.message.includes('OpenAI API failed')) {
        return NextResponse.json({ error: 'OpenAI API failed', details: processingError.message }, { status: 500 })
      } else if (processingError.message.includes('No frames extracted')) {
        return NextResponse.json({ error: 'No frames extracted from video', details: processingError.message }, { status: 500 })
      } else {
        return NextResponse.json({ error: 'Video processing failed', details: processingError.message }, { status: 500 })
      }
    } finally {
      // Clean up temporary files
      if (tempDir) {
        try {
          console.log('Cleaning up temp directory:', tempDir)
          await fs.rm(tempDir, { recursive: true, force: true })
          console.log('Cleanup completed')
        } catch (cleanupError) {
          console.warn('Failed to clean up temporary files:', cleanupError)
        }
      }
    }

  } catch (error) {
    console.error('Video analysis request error:', error)

    // Clean up on error
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch (cleanupError) {
        console.warn('Failed to clean up temporary files on error:', cleanupError)
      }
    }

    return NextResponse.json(
      { error: 'Video analysis failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
