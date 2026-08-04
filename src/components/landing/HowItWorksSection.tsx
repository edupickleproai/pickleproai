'use client'

import { Check } from 'lucide-react'

const steps = [
  {
    number: '1',
    title: 'Create Account',
    description: 'Sign up with your email and complete a quick profile about your playing level and goals.',
  },
  {
    number: '2',
    title: 'Get Personalized Plan',
    description: 'Our AI analyzes your profile and creates a customized training plan just for you.',
  },
  {
    number: '3',
    title: 'Train & Improve',
    description: 'Follow your training plan, upload videos for review, and chat with your AI coach anytime.',
  },
  {
    number: '4',
    title: 'Compete & Win',
    description: 'Find tournaments, prepare with your coach, and track your progress as you climb the rankings.',
  },
]

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-20 md:py-32 bg-gray-50">
      <div className="section-container">
        <div className="text-center mb-16">
          <h2 className="section-title">How PicklePro AI Works</h2>
          <p className="section-subtitle">Four simple steps to transform your pickleball game</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-16">
          {steps.map((step, index) => (
            <div key={index} className="relative">
              {/* Connection line */}
              {index < steps.length - 1 && (
                <div className="hidden lg:block absolute top-20 left-[60%] w-[90%] h-1 bg-gradient-to-r from-primary-300 to-transparent"></div>
              )}

              <div className="bg-white rounded-xl p-8 border-2 border-gray-200 hover:border-primary-300 transition">
                <div className="w-16 h-16 bg-primary-600 text-white rounded-full flex items-center justify-center text-2xl font-bold mb-4 mx-auto">
                  {step.number}
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2 text-center">{step.title}</h3>
                <p className="text-gray-600 text-center">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Benefits */}
        <div className="bg-white rounded-xl p-12 border-2 border-primary-200">
          <h3 className="text-2xl font-bold text-gray-900 mb-8">What You&apos;ll Achieve</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              'Faster skill development with AI-guided practice',
              'Personalized drills targeting your weak points',
              'Video analysis of your technique and form',
              'Real-time feedback from your AI coach',
              'Access to thousands of training videos',
              'Tournament preparation and strategy guides',
            ].map((benefit, index) => (
              <div key={index} className="flex items-center gap-4">
                <div className="w-6 h-6 bg-primary-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <Check className="w-4 h-4 text-white" />
                </div>
                <span className="text-gray-700">{benefit}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
