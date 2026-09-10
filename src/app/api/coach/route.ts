import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { addCoachingReviewNotice, sanitizeCoachingBiomechanicsPayload } from '@/lib/coaching-biomechanics'
import { buildCoachEvidence, groundCoachResponse } from '@/lib/coach-evidence'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const message = String(body?.message || '').trim()
  const level = String(body?.level || 'Intermediate')
  const goals = Array.isArray(body?.goals) ? body.goals.join(', ') : String(body?.goals || 'general improvement')
  const weaknesses = Array.isArray(body?.weaknesses) ? body.weaknesses.join(', ') : String(body?.weaknesses || 'none specified')
  const dominantHand = String(body?.dominantHand || 'right')
  const playStyle = String(body?.playStyle || 'balanced')
  const coachingBiomechanics = sanitizeCoachingBiomechanicsPayload(body?.coachingBiomechanics)
  const evidence = buildCoachEvidence(message, coachingBiomechanics)

  if (!message) {
    return NextResponse.json({ error: 'Message is required.' }, { status: 400 })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'OpenAI API key is not configured.' }, { status: 500 })
  }

  const client = new OpenAI({ apiKey })
  const systemPrompt = `You are a professional pickleball coach answering the player's actual question. For video-specific or metric-specific questions, relevant trusted video-derived evidence takes priority over profile goals. Distinguish measured observations from tentative interpretation. Never manufacture a fault to fill the Diagnosis section. The chat has measurements only, not direct access to video footage. Do not claim to have seen movements beyond the supplied evidence.

Always respond with EXACTLY this format (no extra text):

Diagnosis:
[2-3 sentences interpreting the relevant evidence and its limits, or acknowledging insufficient evidence; no generic opening such as "It sounds like" when measurements exist]

Drills:
- [Drill name or evidence-gathering exercise] — [brief instructions tied to the question; conditional if evidence cannot establish a fault]

Practical Tip:
[One simple, actionable tip you can start right now]

Next Step:
[One specific next action to take today]

Keep every section short and practical. Use profile information only to tailor the difficulty and delivery of advice, never to replace available video evidence. Do not infer a fault, persistent asymmetry, or the need to change knee angles from one reliable frame or a left/right difference alone.

When trusted biomechanics are supplied, use COACHING ELIGIBLE values as factual measurements. Treat COACHING ELIGIBLE — REVIEW values cautiously and mention uncertainty when they materially affect advice. Never infer missing biomechanics or treat omitted metrics as measurements.`

  console.info('OpenAI coach request:', { level, goals, weaknesses, dominantHand, playStyle })

  try {
    const openAiPromise = client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Player request: ${message}\n\n${evidence.prompt}\n\nSecondary tailoring context:\nPlayer level: ${level}\nGoals: ${goals}\nWeaknesses: ${weaknesses}\nDominant hand: ${dominantHand}\nPlay style: ${playStyle}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 600,
    })

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('OpenAI request timed out.')), 20000)
    })

    const completion = await Promise.race([openAiPromise, timeoutPromise])

    const text = (completion as any).choices?.[0]?.message?.content
    if (!text) {
      console.error('OpenAI coach missing content response:', completion)
      throw new Error('No response from OpenAI.')
    }

    return NextResponse.json({ text: addCoachingReviewNotice(groundCoachResponse(text, evidence), coachingBiomechanics) })
  } catch (error) {
    console.error('OpenAI coach error:', error)
    return NextResponse.json({ error: 'The coach is unavailable right now.' }, { status: 500 })
  }
}
