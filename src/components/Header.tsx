'use client'

import Link from 'next/link'
import { useState } from 'react'

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 bg-[#1A1A1A]/95 backdrop-blur-md shadow-[0_12px_30px_-20px_rgba(0,0,0,0.8)] border-b border-white/10">
      <nav className="section-container flex items-center justify-between h-16 gap-4 relative">
        {/* Logo */}
        <Link href="/" className="flex items-center hover:opacity-90 transition flex-shrink-0">
          <img
            src="/brand/picklepro-logo.svg"
            alt="PicklePro.AI"
            className="hidden md:block h-[42px] w-[280px] object-contain"
          />
          <img
            src="/brand/picklepro-logo.svg"
            alt="PicklePro.AI"
            className="md:hidden h-[34px] w-[224px] object-contain"
          />
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-8">
          <a href="#features" className="text-white/80 hover:text-white transition">Features</a>
          <a href="#how-it-works" className="text-white/80 hover:text-white transition">How It Works</a>
          <a href="#pricing" className="text-white/80 hover:text-white transition">Pricing</a>
          <a href="#faq" className="text-white/80 hover:text-white transition">FAQ</a>
        </div>

        {/* CTA Buttons */}
        <div className="hidden md:flex items-center gap-4">
          <Link href="/login" className="text-white/80 hover:text-white transition font-semibold">
            Login
          </Link>
          <Link href="/signup" className="btn-primary">
            Get Started
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden text-white/90 hover:text-white transition"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="absolute top-16 left-0 right-0 bg-[#1A1A1A]/98 border-b border-white/10 md:hidden shadow-2xl">
            <div className="flex flex-col gap-4 p-4">
              <a href="#features" className="text-white/80 hover:text-white transition">Features</a>
              <a href="#how-it-works" className="text-white/80 hover:text-white transition">How It Works</a>
              <a href="#pricing" className="text-white/80 hover:text-white transition">Pricing</a>
              <a href="#faq" className="text-white/80 hover:text-white transition">FAQ</a>
              <hr className="border-white/10" />
              <Link href="/login" className="text-white/80 hover:text-white font-semibold">
                Login
              </Link>
              <Link href="/signup" className="btn-primary text-center">
                Get Started
              </Link>
            </div>
          </div>
        )}
      </nav>
    </header>
  )
}
