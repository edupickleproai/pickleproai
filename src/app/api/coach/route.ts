import { NextResponse } from 'next/server'
import OpenAI from 'openai'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const message = String(body?.message || '').trim()
  const level = String(body?.level || 'Intermediate')
  const goals = Array.isArray(body?.goals) ? body.goals.join(', ') : String(body?.goals || 'general improvement')
  const weaknesses = Array.isArray(body?.weaknesses) ? body.weaknesses.join(', ') : String(body?.weaknesses || 'none specified')
  const dominantHand = String(body?.dominantHand || 'right')
  const playStyle = String(body?.playStyle || 'balanced')

  if (!message) {
    return NextResponse.json({ error: 'Message is required.' }, { status: 400 })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'OpenAI API key is not configured.' }, { status: 500 })
  }

  const client = new OpenAI({ apiKey })
  const systemPrompt = `You are a friendly, professional pickleball coach. Always respond with EXACTLY this format (no extra text):

Diagnosis:
[1-2 sentences describing the issue in a conversational way]

Drills:
• [Drill name] — [brief, actionable instructions]
• [Drill name] — [brief, actionable instructions]

Practical Tip:
[One simple, actionable tip you can start right now]

Next Step:
[One specific next action to take today]

Keep every section short and practical. Be conversational and encouraging. Adapt to ${level} level, focused on: ${goals}. Address weaknesses: ${weaknesses}. Consider ${dominantHand}-handed player with ${playStyle} play style.`

  console.info('OpenAI coach request:', { level, goals, weaknesses, dominantHand, playStyle })

  try {
    const openAiPromise = client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Player level: ${level}\nGoals: ${goals}\nWeaknesses: ${weaknesses}\nDominant hand: ${dominantHand}\nPlay style: ${playStyle}\n\n${message}`,
        },
      ],
      temperature: 0.8,
      max_tokens: 450,
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

    return NextResponse.json({ text })
  } catch (error) {
    console.error('OpenAI coach error:', error)
    return NextResponse.json({ error: 'The coach is unavailable right now.' }, { status: 500 })
  }
}
