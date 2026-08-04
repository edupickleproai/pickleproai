'use client'

import { Check } from 'lucide-react'
import Link from 'next/link'

const plans = [
  {
    name: 'Free',
    price: '$0',
    description: 'Perfect for getting started',
    features: [
      'Limited AI coach access',
      '1 basic training plan',
      'Daily pickleball news',
      'Simple tournament search',
      'Mobile app access',
    ],
    cta: 'Get Started',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$9.99',
    period: '/month',
    description: 'For serious players',
    features: [
      'Unlimited AI coach access',
      'Personalized training plans',
      'Video review and feedback',
      'Tournament preparation guide',
      'Advanced analytics',
      'Priority support',
    ],
    cta: 'Start Free Trial',
    highlighted: true,
  },
  {
    name: 'Family',
    price: '$19.99',
    period: '/month',
    description: 'For coaches and families',
    features: [
      'Up to 5 player profiles',
      'Individual training plans',
      'Video review for all',
      'Performance tracking',
      'Coach dashboard',
      'Family reports',
      'Admin features',
    ],
    cta: 'Start Free Trial',
    highlighted: false,
  },
]

export default function PricingSection() {
  return (
    <section id="pricing" className="py-20 md:py-32 bg-white">
      <div className="section-container">
        <div className="text-center mb-16">
          <h2 className="section-title">Simple, Transparent Pricing</h2>
          <p className="section-subtitle">Choose the perfect plan for your pickleball journey</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {plans.map((plan, index) => (
            <div
              key={index}
              className={`rounded-xl p-8 transition-all duration-300 ${
                plan.highlighted
                  ? 'border-2 border-primary-600 shadow-2xl transform md:scale-105 bg-primary-50'
                  : 'border-2 border-gray-200 bg-white hover:border-primary-300'
              }`}
            >
              {plan.highlighted && (
                <div className="bg-primary-600 text-white px-3 py-1 rounded-full text-xs font-semibold inline-block mb-4">
                  Most Popular
                </div>
              )}

              <h3 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h3>
              <p className="text-gray-600 mb-6">{plan.description}</p>

              <div className="mb-6">
                <span className="text-4xl font-bold text-gray-900">{plan.price}</span>
                {plan.period && <span className="text-gray-600">{plan.period}</span>}
              </div>

              <Link
                href="/signup"
                className={`block text-center py-3 rounded-lg font-semibold mb-8 transition ${
                  plan.highlighted
                    ? 'btn-primary'
                    : 'btn-outline'
                }`}
              >
                {plan.cta}
              </Link>

              <ul className="space-y-4">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-primary-600 flex-shrink-0" />
                    <span className="text-gray-700">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 bg-primary-50 rounded-xl p-8 text-center">
          <p className="text-gray-700 mb-4">
            <strong>Special Offer:</strong> Start your free 7-day trial on any paid plan. No credit card required.
          </p>
          <p className="text-sm text-gray-600">
            All plans include access to basic features. Cancel anytime.
          </p>
        </div>
      </div>
    </section>
  )
}
