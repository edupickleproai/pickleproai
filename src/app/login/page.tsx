'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!email || !password) {
      setError('Please enter your email and password.')
      return
    }
    setError('')
    router.push('/dashboard')
  }

  return (
    <main className="min-h-screen bg-[#06080D] text-white">
      <div className="section-container flex min-h-screen items-center justify-center py-20">
        <div className="w-full max-w-lg rounded-[2rem] border border-white/10 bg-[#0D1524]/[0.96] p-8 shadow-[0_40px_120px_-50px_rgba(24,166,100,0.45)] backdrop-blur-sm">
          <div className="mb-8">
            <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Login</p>
            <h1 className="mt-4 text-4xl font-bold text-white">Welcome back</h1>
            <p className="mt-3 text-slate-400">Access your AI coaching dashboard and continue your training journey.</p>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-[#0C1422] px-4 py-3 text-white outline-none transition focus:border-[#57FF00]/50 focus:ring-2 focus:ring-[#57FF00]/20"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-[#0C1422] px-4 py-3 text-white outline-none transition focus:border-[#57FF00]/50 focus:ring-2 focus:ring-[#57FF00]/20"
                placeholder="Enter your password"
              />
            </div>

            {error && <p className="text-sm text-[#FF6B6B]">{error}</p>}

            <button
              type="submit"
              className="btn-primary w-full text-lg px-8 py-4 transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(87,255,0,0.25)]"
            >
              Continue to dashboard
            </button>
          </form>

          <div className="mt-8 border-t border-white/10 pt-6 text-sm text-slate-400">
            <p>
              New to PicklePro AI?{' '}
              <Link href="/signup" className="text-white hover:text-[#57FF00] transition">
                Create account
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
