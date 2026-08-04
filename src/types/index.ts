// User and Authentication types
export interface User {
  id: string
  email: string
  createdAt: Date
  updatedAt: Date
}

// Player Profile types
export type SkillLevel = 'beginner' | 'intermediate' | 'advanced'
export type MainGoal = 'fitness' | 'tournaments' | 'social_play' | 'improve_technique' | 'improve_strategy'
export type DominantHand = 'right' | 'left'
export type PlayStyle = 'aggressive' | 'defensive' | 'all_court' | 'baseline' | 'net_rusher' | 'balanced'
export type Weakness = 'serve' | 'return' | 'dink' | 'volley' | 'footwork' | 'strategy' | 'consistency' | 'mental_game'
export type TournamentDistance = '10_miles' | '25_miles' | '50_miles' | '100_miles' | 'any_distance'

export interface PlayerProfile {
  id: string
  userId: string
  name: string
  age: number
  country: string
  city: string
  state: string
  zipCode: string
  skillLevel: SkillLevel
  mainGoal: MainGoal
  dominantHand: DominantHand
  playStyle: PlayStyle
  weeklyTrainingFrequency: number
  weaknesses: Weakness[]
  tournamentInterest: boolean
  preferredTournamentDistance: TournamentDistance
  createdAt: Date
  updatedAt: Date
}

// Training Plan types
export interface TrainingPlan {
  id: string
  userId: string
  title: string
  weekStart: Date
  weekEnd: Date
  content: string
  createdAt: Date
  updatedAt: Date
}

export interface Drill {
  id: string
  trainingPlanId: string
  title: string
  category: Weakness
  instructions: string
  duration: number // in minutes
  goal: string
  metrics: string
}

// Chat types
export interface CoachMessage {
  id: string
  userId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: Date
}

// Video types
export interface UploadedVideo {
  id: string
  userId: string
  videoUrl: string
  category: Weakness | 'match_point' | 'general_review'
  userNotes: string
  aiFeedback: string | null
  createdAt: Date
  updatedAt: Date
}

// Tournament types
export type TournamentLevel = 'beginner' | 'intermediate' | 'advanced' | 'open_pro'
export type EventType = 'amateur' | 'professional' | 'mixed_doubles' | "men's_doubles" | "women's_doubles" | 'singles' | 'junior' | 'senior'

export interface Tournament {
  id: string
  name: string
  startDate: Date
  endDate: Date
  city: string
  state: string
  country: string
  venue: string
  level: TournamentLevel
  eventType: EventType[]
  categories: string[]
  officialUrl: string
  source: string
  createdAt: Date
  updatedAt: Date
}

export interface SavedTournament {
  id: string
  userId: string
  tournamentId: string
  createdAt: Date
}

// News types
export type NewsCategory = 'tournament' | 'pro_player' | 'equipment' | 'rules' | 'business' | 'community'

export interface NewsArticle {
  id: string
  title: string
  summary: string
  sourceName: string
  sourceUrl: string
  publishedAt: Date
  category: NewsCategory
  aiSummary: string | null
  createdAt: Date
  updatedAt: Date
}

// Pro Highlights types
export type Circuit = 'PPA' | 'MLP' | 'APP' | 'other'

export interface ProHighlight {
  id: string
  tournamentName: string
  circuit: Circuit
  startDate: Date
  endDate: Date
  location: string
  summary: string
  keyMatches: string
  playersFeatured: string[]
  lessonsForAmateurs: string
  officialUrl: string
  videoUrl: string | null
  createdAt: Date
  updatedAt: Date
}
