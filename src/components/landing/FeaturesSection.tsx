'use client'

import { Brain, Video, Target, Trophy, Newspaper, Zap } from 'lucide-react'

const features = [
  {
    icon: Brain,
    title: 'AI Coach',
    description: 'Get personalized coaching advice on technique, strategy, and mental game, adapted to your skill level and goals.',
  },
  {
    icon: Target,
    title: 'Training Plans',
    description: 'Receive customized weekly training plans with specific drills, goals, and progression based on your profile.',
  },
  {
    icon: Video,
    title: 'Video Review',
    description: 'Upload your videos and receive AI-powered feedback on your technique, footwork, and positioning.',
  },
  {
    icon: Trophy,
    title: 'Tournament Finder',
    description: 'Search and register for local and national pickleball tournaments. Get preparation tips from your AI coach.',
  },
  {
    icon: Newspaper,
    title: 'Daily News',
    description: 'Stay updated with curated pickleball news, player highlights, and rule changes from around the world.',
  },
  {
    icon: Zap,
    title: 'Pro Highlights',
    description: 'Watch professional tournament highlights and learn techniques from the best players in the world.',
  },
]

export default function FeaturesSection() {
  return (
    <section id="features" className="py-20 md:py-32 bg-white">
      <div className="section-container">
        <div className="text-center mb-16">
          <h2 className="section-title">Powerful Features Built for Success</h2>
          <p className="section-subtitle">Everything you need to improve your game and dominate the court</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => {
            const Icon = feature.icon
            return (
              <div
                key={index}
                className="p-8 bg-white border-2 border-gray-100 rounded-xl hover:border-primary-300 hover:shadow-lg transition-all duration-300 group"
              >
                <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center mb-4 group-hover:bg-primary-200 transition">
                  <Icon className="w-6 h-6 text-primary-600" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-gray-600">{feature.description}</p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
