'use client'

import Link from 'next/link'
import { ArrowRight, Sparkles } from 'lucide-react'

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-[#06080D] py-24 md:py-32">
      <div className="absolute inset-x-0 top-0 h-[420px] bg-gradient-to-b from-[#0f172a] via-[#09101c] to-transparent" />
      <div className="absolute -right-24 top-12 w-80 h-80 rounded-full bg-[#57FF00]/15 blur-3xl opacity-50" />
      <div className="absolute -left-20 bottom-0 w-72 h-72 rounded-full bg-[#0085F0]/15 blur-3xl opacity-40" />
      <div className="section-container relative z-10">
        <div className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr] items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white/90 border border-white/10 mb-6 backdrop-blur">
              <Sparkles className="w-4 h-4 text-[#57FF00]" />
              <span>AI-Powered Pickleball Training</span>
            </div>

            <h1 className="text-5xl md:text-6xl xl:text-7xl font-bold tracking-tight text-white leading-tight mb-8">
              Improve your pickleball faster with your personal AI coach.
            </h1>

            <p className="max-w-2xl text-lg md:text-xl text-slate-300 leading-relaxed mb-10">
              Personalized strategy, instant video feedback, and pro-level insights in one premium coaching experience. Train with data, refine every swing, and dominate the court.
            </p>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-10">
              <Link href="/signup" className="btn-primary inline-flex items-center justify-center gap-2 px-8 py-4 text-lg hover:scale-105 hover:shadow-[0_0_30px_rgba(87,255,0,0.3)] transition-all duration-300">
                Start Free Trial
                <ArrowRight className="w-5 h-5" />
              </Link>
              <button className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-8 py-4 text-lg font-semibold text-white/90 transition-all duration-300 hover:border-white/25 hover:bg-white/10 hover:scale-105 hover:shadow-[0_0_20px_rgba(255,255,255,0.1)]">
                Watch Demo
              </button>
            </div>

            <div className="grid grid-cols-3 gap-6 text-sm md:text-base text-slate-300">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <p className="text-2xl font-semibold text-white">10K+</p>
                <p className="mt-1 text-slate-400">Active players</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <p className="text-2xl font-semibold text-white">4.9★</p>
                <p className="mt-1 text-slate-400">Average rating</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <p className="text-2xl font-semibold text-white">50+</p>
                <p className="mt-1 text-slate-400">Countries coached</p>
              </div>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-2xl lg:max-w-xl">
            <div className="absolute inset-x-0 top-10 h-[420px] rounded-[2.5rem] bg-[#57FF00]/15 blur-3xl opacity-70" />
            <div className="absolute inset-x-0 top-8 h-[440px] rounded-[2.5rem] bg-[#0085F0]/10 blur-3xl opacity-40" />
            <div className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-[#0D1524]/[0.96] shadow-[0_40px_120px_-50px_rgba(24,166,100,0.45)]">
              <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.18),_transparent_70%)]" />
              <div className="p-6 md:p-8">
                {/* Tab Navigation */}
                <div className="mb-6 flex items-center justify-between">
                  <div className="flex gap-1 rounded-full border border-white/10 bg-white/5 p-1">
                    <button className="rounded-full bg-[#57FF00]/20 px-3 py-1 text-xs font-semibold text-[#57FF00]">Chat</button>
                    <button className="rounded-full px-3 py-1 text-xs font-semibold text-white/60 hover:text-white">Plan</button>
                    <button className="rounded-full px-3 py-1 text-xs font-semibold text-white/60 hover:text-white">Stats</button>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.25em] text-slate-200">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#57FF00]/20 text-[#57FF00] text-[11px] font-bold">AI</span>
                    Live
                  </div>
                </div>

                {/* AI Chat Interface */}
                <div className="space-y-4">
                  {/* AI Message */}
                  <div className="flex gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#57FF00]/20 text-[#57FF00]">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div className="flex-1 rounded-2xl bg-white/5 p-4">
                      <p className="text-sm text-white/90">
                        Your forehand consistency improved 23% this week! Let&apos;s work on your backhand slice next.
                      </p>
                    </div>
                  </div>

                  {/* User Message */}
                  <div className="flex gap-3 justify-end">
                    <div className="max-w-[70%] rounded-2xl bg-[#57FF00]/20 p-4">
                      <p className="text-sm text-white">
                        What&apos;s the best drill for improving my backhand?
                      </p>
                    </div>
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white">
                      <span className="text-xs font-semibold">JD</span>
                    </div>
                  </div>

                  {/* AI Response */}
                  <div className="flex gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#57FF00]/20 text-[#57FF00]">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div className="flex-1 rounded-2xl bg-white/5 p-4">
                      <p className="text-sm text-white/90 mb-3">
                        Try the &quot;Wall Drill&quot;: Stand 10 feet from a wall and practice your backhand slice. Focus on keeping your elbow high and following through.
                      </p>
                      <div className="flex gap-2">
                        <span className="rounded-full bg-[#57FF00]/20 px-2 py-1 text-xs text-[#57FF00]">Wall Drill</span>
                        <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-white/70">15 min</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Training Plan Preview */}
                <div className="mt-6 rounded-2xl border border-white/10 bg-[#0E1A33]/[0.95] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-white">Today&apos;s Plan</p>
                    <span className="rounded-full bg-[#57FF00]/20 px-2 py-1 text-xs text-[#57FF00]">Active</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-2 rounded-full bg-[#57FF00]" />
                      <span className="text-xs text-white/80">Wall Drill (15 min)</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-2 rounded-full bg-white/30" />
                      <span className="text-xs text-white/60">Footwork Patterns (20 min)</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-2 rounded-full bg-white/30" />
                      <span className="text-xs text-white/60">Video Analysis (10 min)</span>
                    </div>
                  </div>
                </div>

                {/* Performance Stats */}
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-white/5 p-3 text-center">
                    <p className="text-lg font-semibold text-[#57FF00]">93</p>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Accuracy</p>
                  </div>
                  <div className="rounded-xl bg-white/5 p-3 text-center">
                    <p className="text-lg font-semibold text-white">+23%</p>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">This Week</p>
                  </div>
                  <div className="rounded-xl bg-white/5 p-3 text-center">
                    <p className="text-lg font-semibold text-white">47</p>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Sessions</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute -bottom-8 left-6 rounded-full border border-white/10 bg-white/5 px-5 py-3 shadow-xl backdrop-blur-md">
              <div className="flex items-center gap-3 text-sm text-white">
                <span className="inline-flex h-3 w-3 rounded-full bg-[#57FF00] shadow-[0_0_20px_rgba(87,255,0,0.45)]" />
                <span>Real-time AI coaching</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
