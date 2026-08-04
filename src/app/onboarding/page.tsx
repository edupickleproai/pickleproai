'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const goals = ['Improve consistency', 'Win tournaments', 'Fitness', 'Better strategy']
const weaknesses = ['Backhand', 'Serve', 'Footwork', 'Net play']
const skillLevels = ['Beginner', 'Intermediate', 'Advanced']
const dominantHands = ['Right', 'Left']
const playStyles = ['Aggressive', 'Defensive', 'All-court', 'Baseline', 'Net rusher', 'Balanced']

export default function OnboardingPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [skillLevel, setSkillLevel] = useState('Intermediate')
  const [dominantHand, setDominantHand] = useState('Right')
  const [playStyle, setPlayStyle] = useState('Balanced')
  const [selectedGoals, setSelectedGoals] = useState<string[]>([])
  const [selectedWeaknesses, setSelectedWeaknesses] = useState<string[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    const savedEmail = window.localStorage.getItem('picklepro:email')
    if (savedEmail && !name) {
      setName('')
    }
  }, [name])

  const toggleValue = (value: string, values: string[], setter: (items: string[]) => void) => {
    if (values.includes(value)) {
      setter(values.filter((item) => item !== value))
    } else {
      setter([...values, value])
    }
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!name.trim()) {
      setError('Please enter your name.')
      return
    }
    if (selectedGoals.length === 0) {
      setError('Please choose at least one goal.')
      return
    }
    setError('')
    window.localStorage.setItem(
      'picklepro:user',
      JSON.stringify({ name: name.trim(), skillLevel, dominantHand, playStyle, goals: selectedGoals, weaknesses: selectedWeaknesses })
    )
    router.push('/dashboard')
  }

  return (
    <main className="min-h-screen bg-[#06080D] text-white">
      <div className="section-container flex min-h-screen items-center justify-center py-20">
        <div className="w-full max-w-3xl rounded-[2rem] border border-white/10 bg-[#0D1524]/[0.96] p-8 shadow-[0_40px_120px_-50px_rgba(24,166,100,0.45)] backdrop-blur-sm">
          <div className="mb-8">
            <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Onboarding</p>
            <h1 className="mt-4 text-4xl font-bold text-white">Tell us who you are</h1>
            <p className="mt-3 text-slate-400">Your answers help build a training plan tailored to your skill level and goals.</p>
          </div>

          <form className="space-y-8" onSubmit={handleSubmit}>
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2" htmlFor="name">
                Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-[#0C1422] px-4 py-3 text-white outline-none transition focus:border-[#57FF00]/50 focus:ring-2 focus:ring-[#57FF00]/20"
                placeholder="Your name"
              />
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-300 mb-3">Skill level</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {skillLevels.map((level) => (
                  <button
                    type="button"
                    key={level}
                    onClick={() => setSkillLevel(level)}
                    className={`rounded-3xl border px-4 py-3 text-sm font-semibold transition ${
                      skillLevel === level
                        ? 'border-[#57FF00] bg-[#57FF00]/10 text-white'
                        : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/30 hover:bg-white/10'
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-300 mb-3">Dominant hand</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {dominantHands.map((hand) => (
                  <button
                    type="button"
                    key={hand}
                    onClick={() => setDominantHand(hand)}
                    className={`rounded-3xl border px-4 py-3 text-sm font-semibold transition ${
                      dominantHand === hand
                        ? 'border-[#57FF00] bg-[#57FF00]/10 text-white'
                        : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/30 hover:bg-white/10'
                    }`}
                  >
                    {hand}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-300 mb-3">Play style</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {playStyles.map((style) => (
                  <button
                    type="button"
                    key={style}
                    onClick={() => setPlayStyle(style)}
                    className={`rounded-3xl border px-4 py-3 text-sm font-semibold transition ${
                      playStyle === style
                        ? 'border-[#57FF00] bg-[#57FF00]/10 text-white'
                        : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/30 hover:bg-white/10'
                    }`}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-300 mb-3">Goals</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {goals.map((goal) => (
                  <button
                    key={goal}
                    type="button"
                    onClick={() => toggleValue(goal, selectedGoals, setSelectedGoals)}
                    className={`rounded-3xl border px-4 py-3 text-sm text-left transition ${
                      selectedGoals.includes(goal)
                        ? 'border-[#57FF00] bg-[#57FF00]/10 text-white'
                        : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/30 hover:bg-white/10'
                    }`}
                  >
                    {goal}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-300 mb-3">Weaknesses</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {weaknesses.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => toggleValue(item, selectedWeaknesses, setSelectedWeaknesses)}
                    className={`rounded-3xl border px-4 py-3 text-sm text-left transition ${
                      selectedWeaknesses.includes(item)
                        ? 'border-[#57FF00] bg-[#57FF00]/10 text-white'
                        : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/30 hover:bg-white/10'
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-[#FF6B6B]">{error}</p>}

            <button
              type="submit"
              className="btn-primary w-full text-lg px-8 py-4 transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(87,255,0,0.25)]"
            >
              Complete onboarding
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
