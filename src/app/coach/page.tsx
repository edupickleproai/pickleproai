'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Send } from 'lucide-react'

type Message = {
  role: 'user' | 'assistant'
  content: string
}

type UserProfile = {
  name?: string
  skillLevel?: string
  dominantHand?: string
  playStyle?: string
  goals?: string[]
  weaknesses?: string[]
}

// Parse structured coach response into sections
function parseCoachResponse(text: string) {
  const diagnosisMatch = text.match(/Diagnosis:\s*([\s\S]*?)(?=Drills:|$)/i)
  const drillsMatch = text.match(/Drills:\s*([\s\S]*?)(?=Practical Tip:|$)/i)
  const tipMatch = text.match(/Practical Tip:\s*([\s\S]*?)(?=Next Step:|$)/i)
  const nextStepMatch = text.match(/Next Step:\s*([\s\S]*?)$/i)

  return {
    diagnosis: diagnosisMatch ? diagnosisMatch[1].trim() : '',
    drills: drillsMatch ? drillsMatch[1].trim() : '',
    tip: tipMatch ? tipMatch[1].trim() : '',
    nextStep: nextStepMatch ? nextStepMatch[1].trim() : '',
  }
}

export default function CoachPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        'Hello! I\'m your AI pickleball coach. Ask me for advice, drills, or training tips based on your level and goals.',
    },
  ])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle')
  const [error, setError] = useState('')
  const [profile, setProfile] = useState<UserProfile>({ skillLevel: 'Intermediate', dominantHand: 'Right', playStyle: 'Balanced', goals: ['Improve consistency'], weaknesses: [] })
  const inputRef = useRef<HTMLInputElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const saved = window.localStorage.getItem('picklepro:user')
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as UserProfile
        setProfile((prev) => ({ ...prev, ...parsed }))
      } catch {
        // ignore invalid data
      }
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, status])

  const goalsText = useMemo(() => {
    if (!profile.goals?.length) return 'general improvement'
    return profile.goals.join(', ')
  }, [profile.goals])

  const weaknessesText = useMemo(() => {
    if (!profile.weaknesses?.length) return 'none specified'
    return profile.weaknesses.join(', ')
  }, [profile.weaknesses])

  const sendMessage = async () => {
    if (!input.trim()) return
    const requestText = input.trim()
    const updatedMessages: Message[] = [...messages, { role: 'user', content: requestText }]
    setMessages(updatedMessages)
    setInput('')
    setStatus('sending')
    setError('')

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 25000)

    try {
      console.log("Sending message to /api/coach")
      const response = await fetch('/api/coach', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: requestText,
          level: profile.skillLevel,
          goals: goalsText,
          weaknesses: weaknessesText,
          dominantHand: profile.dominantHand,
          playStyle: profile.playStyle,
        }),
        signal: controller.signal,
      })

      const text = await response.text()
      let result: { text?: string; error?: string } = { error: 'Unable to parse coach response.' }
      try {
        result = JSON.parse(text)
      } catch (parseError) {
        console.error('Coach response parse error:', parseError, 'raw response:', text)
      }

      console.log("API response:", result)

      if (!response.ok) {
        const message = result?.error || `Coach API returned status ${response.status}`
        throw new Error(message)
      }

      if (!result?.text) {
        throw new Error('The coach response was empty.')
      }

      setMessages((current) => [...current, { role: 'assistant', content: result.text }])
      setTimeout(() => inputRef.current?.focus(), 0)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong.'
      console.error('Coach client error:', err)
      setError(message)
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: `Coach error: ${message}`,
        },
      ])
    } finally {
      window.clearTimeout(timeoutId)
      setStatus('idle')
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await sendMessage()
  }

  return (
    <main className="min-h-screen bg-[#0B0F14] text-white">
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="relative w-full max-w-[800px] rounded-[2rem] border border-white/10 bg-[#0D1524]/[0.96] shadow-[0_40px_120px_-50px_rgba(24,166,100,0.45)] backdrop-blur-sm">
          <div className="border-b border-white/10 px-6 py-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.35em] text-slate-400">AI Coach</p>
                <h1 className="mt-3 text-3xl font-bold text-white">Your personal pickleball coach</h1>
                <p className="mt-2 max-w-2xl text-slate-400">Chat naturally and get practical drills, strategy, and training advice tailored to your level.</p>
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

          <div className="relative h-[50vh] overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#0B0F14] via-transparent to-transparent" />
            <div className="h-full overflow-y-auto px-6 pb-36 pt-6">
              <div className="space-y-4">
                {messages.map((message, index) => {
                  const isAssistant = message.role === 'assistant'
                  const parsed = isAssistant ? parseCoachResponse(message.content) : null
                  
                  return (
                    <div
                      key={`${message.role}-${index}`}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-[1.75rem] border px-5 py-4 text-sm leading-7 shadow-[0_20px_60px_-40px_rgba(0,0,0,0.7)] ${
                          message.role === 'user'
                            ? 'bg-[#57FF00]/20 border-[#57FF00]/25 text-white'
                            : 'bg-[#111827]/[0.95] border-white/10 text-slate-200'
                        }`}
                      >
                        {isAssistant && parsed && (parsed.diagnosis || parsed.drills || parsed.tip || parsed.nextStep) ? (
                          <div className="space-y-3">
                            {parsed.diagnosis && (
                              <div>
                                <h4 className="font-semibold text-[#57FF00] text-xs uppercase tracking-wider mb-1">Diagnosis</h4>
                                <p className="text-slate-200">{parsed.diagnosis}</p>
                              </div>
                            )}
                            {parsed.drills && (
                              <div>
                                <h4 className="font-semibold text-[#57FF00] text-xs uppercase tracking-wider mb-1">Drills</h4>
                                <div className="text-slate-200 whitespace-pre-wrap">{parsed.drills}</div>
                              </div>
                            )}
                            {parsed.tip && (
                              <div>
                                <h4 className="font-semibold text-[#57FF00] text-xs uppercase tracking-wider mb-1">Practical Tip</h4>
                                <p className="text-slate-200">{parsed.tip}</p>
                              </div>
                            )}
                            {parsed.nextStep && (
                              <div>
                                <h4 className="font-semibold text-[#57FF00] text-xs uppercase tracking-wider mb-1">Next Step</h4>
                                <p className="text-slate-200">{parsed.nextStep}</p>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p>{message.content}</p>
                        )}
                      </div>
                    </div>
                  )
                })}

                {status === 'sending' && (
                  <div className="flex justify-start">
                    <div className="max-w-[70%] animate-pulse rounded-[1.75rem] border border-white/10 bg-[#111827]/[0.95] px-5 py-4 text-sm leading-7 text-slate-400 shadow-[0_20px_60px_-40px_rgba(0,0,0,0.7)]">
                      <div className="h-3 w-20 rounded-full bg-slate-700 mb-2" />
                      <div className="flex gap-2">
                        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-slate-700"></span>
                        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-slate-700"></span>
                        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-slate-700"></span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div ref={messagesEndRef} />
            </div>

            <div className="px-6 py-4 border-t border-white/10 bg-[#0D1524]/[0.96]">
              <div className="mx-auto max-w-3xl">
                <p className="text-xs uppercase tracking-[0.35em] text-slate-400 mb-3">Example prompts</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setInput('Improve my backhand')}
                    className="text-left px-3 py-2 rounded-lg border border-white/10 bg-[#0B1321]/[0.95] text-sm text-slate-300 hover:bg-[#111827] hover:border-white/20 transition-colors"
                  >
                    Improve my backhand
                  </button>
                  <button
                    type="button"
                    onClick={() => setInput('Give me a 30-minute drill plan')}
                    className="text-left px-3 py-2 rounded-lg border border-white/10 bg-[#0B1321]/[0.95] text-sm text-slate-300 hover:bg-[#111827] hover:border-white/20 transition-colors"
                  >
                    Give me a 30-minute drill plan
                  </button>
                  <button
                    type="button"
                    onClick={() => setInput('Help me prepare for a tournament')}
                    className="text-left px-3 py-2 rounded-lg border border-white/10 bg-[#0B1321]/[0.95] text-sm text-slate-300 hover:bg-[#111827] hover:border-white/20 transition-colors"
                  >
                    Help me prepare for a tournament
                  </button>
                  <button
                    type="button"
                    onClick={() => setInput('Fix my serve consistency')}
                    className="text-left px-3 py-2 rounded-lg border border-white/10 bg-[#0B1321]/[0.95] text-sm text-slate-300 hover:bg-[#111827] hover:border-white/20 transition-colors"
                  >
                    Fix my serve consistency
                  </button>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 z-10 border-t border-white/10 bg-[#0D1524]/[0.96] px-6 py-5 backdrop-blur-xl">
              <form onSubmit={handleSubmit} method="post">
                <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-full border border-white/10 bg-[#0B1321]/[0.95] px-4 py-3 shadow-[0_20px_60px_-40px_rgba(0,0,0,0.8)]">
                  <input
                    id="coach-input"
                    ref={inputRef}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    className="flex-1 bg-transparent text-white outline-none placeholder:text-slate-500"
                    placeholder="Ask about your serve, footwork, or tournament strategy..."
                  />
                  <button
                    type="submit"
                    disabled={status === 'sending'}
                    className="inline-flex h-12 items-center justify-center rounded-full bg-[#57FF00] px-5 text-sm font-semibold text-[#07120c] transition-colors duration-200 hover:bg-[#4ee100] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
                {error && <p className="mt-3 text-center text-sm text-[#FF6B6B]">{error}</p>}
              </form>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
