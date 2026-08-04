'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export default function CTASection() {
  return (
    <section className="py-20 md:py-32 bg-gradient-to-br from-primary-600 to-green-600 text-white relative overflow-hidden">
      {/* Background elements */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-pattern"></div>
      </div>

      <div className="section-container relative z-10 text-center">
        <h2 className="text-4xl md:text-5xl font-bold mb-6">
          Ready to Transform Your Game?
        </h2>
        <p className="text-xl opacity-90 mb-8 max-w-2xl mx-auto">
          Join thousands of pickleball players improving their skills with PicklePro AI.
          Start your free 7-day trial today.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/signup"
            className="px-8 py-4 bg-white text-primary-600 rounded-lg font-semibold hover:bg-gray-100 transition flex items-center justify-center gap-2"
          >
            Get Started Free
            <ArrowRight className="w-5 h-5" />
          </Link>
          <button className="px-8 py-4 border-2 border-white text-white rounded-lg font-semibold hover:bg-white hover:bg-opacity-10 transition">
            Schedule Demo
          </button>
        </div>

        <p className="mt-8 text-sm opacity-75">
          No credit card required. Cancel anytime.
        </p>
      </div>
    </section>
  )
}
