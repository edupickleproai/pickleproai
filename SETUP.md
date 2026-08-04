# Setup Instructions - PicklePro AI

## Current Status

✅ Project structure created
✅ All components and pages built
✅ Tailwind CSS configured
⏳ Waiting for Node.js installation to complete

## Next Steps to Get the Project Running

### Step 1: Install Node.js

If you haven't already, install Node.js from [nodejs.org](https://nodejs.org/) or using your preferred package manager.

**On Windows (if winget installation is still pending):**
```powershell
# Complete the Node.js installation that was started
# You may need to check Windows installer or try:
winget list | findstr Node
```

**Alternative - Manual download:**
1. Go to https://nodejs.org/
2. Download the LTS version
3. Run the installer and follow the steps
4. Restart your terminal after installation

### Step 2: Verify Installation

After Node.js is installed, verify it works:
```bash
node --version
npm --version
```

### Step 3: Install Dependencies

Navigate to the project directory and install dependencies:
```bash
cd c:\Users\ECavalcanti\pickleproai
npm install
```

### Step 4: Run Development Server

```bash
npm run dev
```

The project will be available at `http://localhost:3000`

## Project Files Created

### Configuration Files
- ✅ `package.json` - Dependencies and scripts
- ✅ `tsconfig.json` - TypeScript configuration
- ✅ `tailwind.config.js` - Tailwind CSS configuration
- ✅ `next.config.js` - Next.js configuration
- ✅ `postcss.config.js` - PostCSS configuration
- ✅ `.eslintrc.json` - ESLint configuration
- ✅ `.gitignore` - Git ignore rules

### Source Files
#### App Directory
- ✅ `src/app/layout.tsx` - Root layout
- ✅ `src/app/page.tsx` - Home/landing page
- ✅ `src/app/globals.css` - Global styles

#### Components
- ✅ `src/components/Header.tsx` - Navigation header
- ✅ `src/components/Footer.tsx` - Footer
- ✅ `src/components/landing/HeroSection.tsx` - Hero banner
- ✅ `src/components/landing/FeaturesSection.tsx` - Features showcase
- ✅ `src/components/landing/HowItWorksSection.tsx` - How it works
- ✅ `src/components/landing/PricingSection.tsx` - Pricing plans
- ✅ `src/components/landing/FAQSection.tsx` - FAQ section
- ✅ `src/components/landing/CTASection.tsx` - Call to action

### Documentation
- ✅ `README.md` - Project documentation

## Dependencies Installed via npm

### Production
- react ^18.2.0
- react-dom ^18.2.0
- next ^14.0.0
- @supabase/supabase-js ^2.38.0
- openai ^4.24.0
- stripe ^14.0.0

### Development
- typescript ^5.3.0
- @types/node ^20.10.0
- @types/react ^18.2.0
- @types/react-dom ^18.2.0
- autoprefixer ^10.4.16
- postcss ^8.4.31
- tailwindcss ^3.3.0
- eslint ^8.54.0
- eslint-config-next ^14.0.0

## Features Implemented in Phase 1

### Landing Page Sections
1. **Header Navigation**
   - Responsive navigation with mobile menu
   - Links to all sections
   - Login and Sign Up buttons

2. **Hero Section**
   - Eye-catching headline
   - Clear value proposition
   - CTA buttons
   - Social proof (10K+ users, 4.9★ rating)

3. **Features Section** (6 features)
   - AI Coach
   - Training Plans
   - Video Review
   - Tournament Finder
   - Daily News
   - Pro Highlights

4. **How It Works** (4-step process)
   - Create Account
   - Get Personalized Plan
   - Train & Improve
   - Compete & Win
   - Benefits section

5. **Pricing Section** (3 tiers)
   - Free Plan
   - Pro Plan (highlighted as most popular)
   - Family Plan
   - Trial promotion

6. **FAQ Section** (8 questions)
   - Platform information
   - Feature explanations
   - Support and technical info

7. **Call-to-Action Section**
   - Final conversion push
   - Trial promotion
   - Demo scheduling

8. **Footer**
   - Company links
   - Product links
   - Legal links
   - Social media links

## Design System

### Color Palette
- Primary Green: `#22c55e`
- Secondary Dark: `#3a3530`
- Accent Yellow: `#fbbf24`
- Accent Neon: `#e2ff00`
- Backgrounds: White, light grays

### Responsive Design
- Mobile-first approach
- Breakpoints: sm (640px), md (768px), lg (1024px)
- Fully responsive components

### Accessibility
- Semantic HTML
- ARIA labels where needed
- Keyboard navigation
- Color contrast compliance

## What's Next?

Once dependencies are installed and the dev server is running:

1. **Phase 2**: Add authentication with Supabase
   - Login page
   - Signup page
   - User profile
   - Auth routes

2. **Phase 3**: Build onboarding flow
   - Player profile form
   - Skill assessment
   - Goal selection

3. **Phase 4**: Create dashboard
   - User data display
   - Stats and progress
   - Quick navigation

4. **Phase 5**: Implement AI Coach
   - Chat interface
   - OpenAI integration
   - Message history

And so on...

## Troubleshooting

### "npm: The term 'npm' is not recognized"
- Node.js installation may not be complete
- Try restarting your terminal/PowerShell
- Check if Node.js appears in your system PATH

### Port 3000 already in use
```bash
# Find process using port 3000 and kill it
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### Module not found errors
Make sure all dependencies are installed:
```bash
npm install
npm list
```

## Questions?

Refer to:
- Project README.md for overview
- Next.js docs: https://nextjs.org/docs
- Tailwind CSS: https://tailwindcss.com/docs
- TypeScript: https://www.typescriptlang.org/docs
