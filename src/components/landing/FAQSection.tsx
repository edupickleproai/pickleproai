'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

const faqs = [
  {
    question: 'What is PicklePro AI?',
    answer: 'PicklePro AI is an AI-powered coaching platform designed specifically for pickleball players. It combines personalized training plans, video analysis, tournament information, and daily news to help you improve your game.',
  },
  {
    question: 'Do I need to be a professional player?',
    answer: 'No! PicklePro AI is for all levels - from beginners to professional players. The AI adapts to your skill level and personalized goals to provide relevant coaching and training.',
  },
  {
    question: 'How does the AI video review work?',
    answer: 'You upload your pickleball videos, select the skill you want to work on (serve, return, dink, etc.), and describe what you want to improve. Our AI provides detailed feedback on your technique and specific drills to address your needs.',
  },
  {
    question: 'Can I use PicklePro AI on my phone?',
    answer: 'Yes! PicklePro AI is fully optimized for mobile devices. You can chat with your AI coach, upload videos, find tournaments, and read news all from your phone.',
  },
  {
    question: 'How do I cancel my subscription?',
    answer: 'You can cancel anytime from your account settings. No hidden fees, no contracts. If you cancel within your trial period, you won\'t be charged.',
  },
  {
    question: 'Is my data secure?',
    answer: 'Yes. We use enterprise-grade encryption and follow GDPR and privacy best practices. Your videos and personal data are secure and private.',
  },
  {
    question: 'Can I invite coaching clients to my account?',
    answer: 'Yes! With the Family or Coach plan, you can create multiple player profiles and track progress for each player separately.',
  },
  {
    question: 'What language does PicklePro AI support?',
    answer: 'Currently, we support English. We\'re preparing to add Portuguese and Spanish support in the coming months.',
  },
]

export default function FAQSection() {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  return (
    <section id="faq" className="py-20 md:py-32 bg-gray-50">
      <div className="section-container max-w-3xl">
        <div className="text-center mb-16">
          <h2 className="section-title">Frequently Asked Questions</h2>
          <p className="section-subtitle">Everything you need to know about PicklePro AI</p>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <div
              key={index}
              className="bg-white rounded-lg border-2 border-gray-200 overflow-hidden hover:border-primary-300 transition"
            >
              <button
                onClick={() => setActiveIndex(activeIndex === index ? null : index)}
                className="w-full p-6 flex items-center justify-between hover:bg-gray-50 transition"
              >
                <span className="text-lg font-semibold text-gray-900 text-left">{faq.question}</span>
                <ChevronDown
                  className={`w-5 h-5 text-primary-600 flex-shrink-0 transition-transform ${
                    activeIndex === index ? 'transform rotate-180' : ''
                  }`}
                />
              </button>

              {activeIndex === index && (
                <div className="px-6 pb-6 text-gray-600">
                  {faq.answer}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-16 bg-primary-50 rounded-xl p-8 text-center">
          <p className="text-gray-700 mb-4">
            Still have questions?
          </p>
          <a
            href="mailto:support@pickleproai.com"
            className="text-primary-600 font-semibold hover:text-primary-700"
          >
            Contact our support team
          </a>
        </div>
      </div>
    </section>
  )
}
