'use client'

import { useEffect, useState } from 'react'

export default function DashboardPage() {
  const [name, setName] = useState('Player')
  const [userLoaded, setUserLoaded] = useState(false)

  useEffect(() => {
    const saved = window.localStorage.getItem('picklepro:user')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        setName(parsed.name || 'Player')
      } catch {
        setName('Player')
      }
    }
    setUserLoaded(true)
  }, [])

  return (
    <main className="min-h-screen bg-[#06080D] text-white">
      <div className="section-container py-20">
        <div className="flex flex-col gap-10">
          <div className="rounded-[2rem] border border-white/10 bg-[#0D1524]/[0.96] p-10 shadow-[0_40px_120px_-50px_rgba(24,166,100,0.45)] backdrop-blur-sm">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Dashboard</p>
                <h1 className="mt-4 text-4xl font-bold text-white">Welcome back{userLoaded ? `, ${name}` : ''}.</h1>
                <p className="mt-3 max-w-2xl text-slate-400">Your personalized coaching workspace is ready. Track progress, review plans, and talk to your AI coach.</p>
              </div>
              <button className="btn-primary inline-flex items-center justify-center gap-2 px-8 py-4 text-lg transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(87,255,0,0.25)]">
                Talk to AI Coach
              </button>
            </div>
          </div>

          <div className="grid gap-8 xl:grid-cols-2">
            <div className="rounded-[2rem] border border-white/10 bg-[#0E1A33]/[0.95] p-8 shadow-[0_30px_90px_-40px_rgba(8,13,27,0.8)]">
              <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Training Plan</p>
              <h2 className="mt-4 text-2xl font-semibold text-white">This week&apos;s focus</h2>
              <ul className="mt-6 space-y-4 text-slate-300">
                <li className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <p className="font-semibold text-white">Wall Drill</p>
                  <p className="mt-1 text-sm text-slate-400">Refine your backhand slice with consistent reps.</p>
                </li>
                <li className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <p className="font-semibold text-white">Footwork Circuit</p>
                  <p className="mt-1 text-sm text-slate-400">Improve speed and positioning across the court.</p>
                </li>
                <li className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <p className="font-semibold text-white">Serve Accuracy</p>
                  <p className="mt-1 text-sm text-slate-400">Build consistency with targeted serve practice.</p>
                </li>
              </ul>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-[#0E1A33]/[0.95] p-8 shadow-[0_30px_90px_-40px_rgba(8,13,27,0.8)]">
              <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Performance Stats</p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl bg-white/5 p-6 text-center">
                  <p className="text-3xl font-semibold text-[#57FF00]">93</p>
                  <p className="mt-2 text-sm text-slate-400">Shot accuracy</p>
                </div>
                <div className="rounded-3xl bg-white/5 p-6 text-center">
                  <p className="text-3xl font-semibold text-white">+23%</p>
                  <p className="mt-2 text-sm text-slate-400">Improvement</p>
                </div>
                <div className="rounded-3xl bg-white/5 p-6 text-center">
                  <p className="text-3xl font-semibold text-white">47</p>
                  <p className="mt-2 text-sm text-slate-400">Sessions</p>
                </div>
                <div className="rounded-3xl bg-white/5 p-6 text-center">
                  <p className="text-3xl font-semibold text-white">4.9★</p>
                  <p className="mt-2 text-sm text-slate-400">Coach rating</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
