# PicklePro AI - MVP

Your AI Pickleball Coach for training, analysis, tournaments, and daily news.

## Project Overview

PicklePro AI is a comprehensive platform that combines:
- **AI Coach**: Personalized coaching advice on technique, strategy, and mental game
- **Training Plans**: Customized weekly training plans with specific drills
- **Video Review**: AI-powered feedback on technique and positioning
- **Tournament Finder**: Search and register for local and national tournaments
- **Daily News**: Curated pickleball news from around the world
- **Pro Highlights**: Professional tournament highlights and lessons

## Tech Stack

- **Frontend**: Next.js 14+ with TypeScript
- **Styling**: Tailwind CSS
- **Icons**: lucide-react
- **Authentication**: Supabase (coming soon)
- **Database**: Supabase (coming soon)
- **AI**: OpenAI API (coming soon)
- **Storage**: Supabase Storage (coming soon)
- **Deployment**: Vercel

## Getting Started

### Prerequisites

- Node.js 18+ (LTS recommended)
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Create environment variables (`.env.local`):
```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
OPENAI_API_KEY=your_openai_api_key
```

3. Run development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## Project Structure

```
src/
├── app/                    # Next.js app directory
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Home/landing page
├── components/
│   ├── landing/           # Landing page sections
│   │   ├── HeroSection.tsx
│   │   ├── FeaturesSection.tsx
│   │   ├── HowItWorksSection.tsx
│   │   ├── PricingSection.tsx
│   │   ├── FAQSection.tsx
│   │   └── CTASection.tsx
│   ├── Header.tsx         # Navigation header
│   └── Footer.tsx         # Footer
├── lib/                   # Utility functions
├── types/                 # TypeScript type definitions
└── hooks/                 # Custom React hooks
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint

## MVP Features Completed

✅ Landing page with hero section
✅ Features showcase
✅ How it works section
✅ Pricing page
✅ FAQ section
✅ Call-to-action sections
✅ Responsive mobile design
✅ Header navigation
✅ Footer

## MVP Roadmap

### Phase 2: Authentication & Database
- [ ] Supabase setup
- [ ] Email/password authentication
- [ ] User profiles
- [ ] Database schema

### Phase 3: Onboarding
- [ ] Player profile form
- [ ] Skill level assessment
- [ ] Goal selection
- [ ] Preferences

### Phase 4: Dashboard
- [ ] User dashboard
- [ ] Progress tracking
- [ ] Quick stats

### Phase 5: AI Coach
- [ ] Chat interface
- [ ] OpenAI integration
- [ ] Conversation history
- [ ] Personalized responses

### Phase 6: Training Plans
- [ ] Plan generation
- [ ] Drill library
- [ ] Progress tracking
- [ ] Weekly planner

### Phase 7: Video Review
- [ ] Video upload
- [ ] Storage integration
- [ ] AI feedback generation
- [ ] Video player

### Phase 8: Tournament Finder
- [ ] Tournament database
- [ ] Search and filters
- [ ] Location-based search
- [ ] API integrations

### Phase 9: News & Highlights
- [ ] News feed
- [ ] Tournament highlights
- [ ] News summarization
- [ ] RSS feed integration

### Phase 10: Pricing & Profiles
- [ ] Stripe integration
- [ ] Subscription management
- [ ] User profiles
- [ ] Settings

## Design System

### Colors
- **Primary**: Green (#22c55e)
- **Secondary**: Dark gray/brown (#3a3530)
- **Accent**: Yellow (#fbbf24)
- **Neon**: Neon yellow (#e2ff00)

### Typography
- Font Family: System fonts (Inter fallback)
- Headings: Bold, high contrast
- Body: Regular, readable

### Components
- Buttons: Primary (filled green), Secondary (outline)
- Cards: Minimal borders, subtle shadows
- Inputs: Clean, accessible
- Icons: Lucide React

## Development Guidelines

- Use TypeScript for type safety
- Follow React best practices
- Keep components small and reusable
- Mobile-first responsive design
- Accessibility (a11y) priority
- Clean, readable code

## Future Enhancements

- Multi-language support (Portuguese)
- Mobile app (React Native)
- Advanced video analysis
- Social features
- Leaderboards
- Integration with tournament APIs
- Payment processing with Stripe
- Email notifications
- Analytics dashboard

## Contributing

This is a private project. Contact the development team for contribution guidelines.

## License

Proprietary - All rights reserved

## Support

For support, email support@pickleproai.com or visit our website.

---

**Current Status**: MVP Phase 1 - Landing page complete
**Next Step**: Phase 2 - Authentication & Database setup
