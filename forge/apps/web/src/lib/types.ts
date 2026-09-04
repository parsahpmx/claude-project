/**
 * Response shapes the web app relies on.
 *
 * These are hand-written rather than generated because the API is the contract
 * and the web app is one of several clients. Keeping them explicit makes a
 * breaking API change fail at compile time here.
 */

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'member' | 'coach' | 'admin';
  unitSystem: 'metric' | 'imperial';
  coachSlug: string | null;
}

export interface MemberProfile {
  userId: string;
  primaryGoal: string;
  secondaryGoals: string[];
  ageRange: string;
  experience: string;
  daysPerWeek: number;
  sessionMinutes: number;
  trainingLocation: string;
  equipment: string[];
  diet: string;
  coachingPreference: string;
  heightCm: number | null;
  weightKg: number | null;
}

export interface Subscription {
  id: string;
  tier: 'forge' | 'forge-pro' | 'forge-coach';
  billingInterval: 'monthly' | 'yearly';
  status: string;
  priceCents: number;
  trialEndsOn: string | null;
  currentPeriodEndsOn: string;
  cancelAtPeriodEnd: boolean;
}

export interface ReadinessComponent {
  key: string;
  label: string;
  score: number;
  weight: number;
  detail: string;
}

export interface Readiness {
  score: number | null;
  band: 'primed' | 'ready' | 'moderate' | 'compromised' | 'unknown';
  headline: string;
  guidance: string;
  components: ReadinessComponent[];
}

export interface PlanDay {
  id: string;
  planWeekId: string;
  date: string;
  dayOfWeek: number;
  kind: string;
  title: string;
  focus: string;
  minutes: number;
  patterns: string[];
  status: 'scheduled' | 'completed' | 'skipped';
  sessionTemplate: string | null;
  rescheduledFrom: string | null;
}

export interface PlanWeek {
  id: string;
  weekNumber: number;
  phase: 'foundation' | 'build' | 'perform';
  startDate: string;
  endDate: string;
  deload: boolean;
  nutritionGoal: string;
  recoveryTarget: string;
  coachCheckIn: boolean;
  milestone: string | null;
  days: PlanDay[];
}

export interface Phase {
  key: 'foundation' | 'build' | 'perform';
  order: number;
  name: string;
  weekStart: number;
  weekEnd: number;
  focus: string[];
}

export interface Plan {
  id: string;
  programSlug: string;
  programName: string;
  goal: string;
  startDate: string;
  totalWeeks: number;
  sessionsPerWeek: number;
  sessionMinutes: number;
  status: string;
  phases: Phase[];
}

export interface ExercisePrescription {
  sets: number;
  reps: number;
  repsTop?: number;
  loadGrams: number;
  rpe?: number;
  restSeconds: number;
  tempo?: string;
}

export interface SessionExercise {
  order: number;
  exerciseId: string;
  name: string;
  cue: string;
  pattern: string;
  timed: boolean;
  prescription: ExercisePrescription;
  substitutes: { id: string; name: string }[];
  previous?: {
    loadGrams: number;
    reps: number | null;
    rpe: number | null;
    bestLoadGrams: number;
  } | null;
}

export interface BuiltSession {
  title: string;
  kind: string;
  focus: string;
  minutes: number;
  exercises: SessionExercise[];
  warmup: string[];
  cooldown: string[];
  coachNote: string;
}

export interface Program {
  slug: string;
  name: string;
  tagline: string;
  summary: string;
  weeks: number;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  sessionsPerWeek: number;
  sessionMinutes: number;
  location: string;
  styles: string[];
  goals: string[];
  equipment: string[];
  progression: string;
  coachSlug: string;
  rating: number;
  reviewCount: number;
  memberCount: number;
  outcomes: string[];
  whoItIsFor: string[];
  template: { day: number; name: string; kind: string; focus: string; minutes: number; patterns: string[] }[];
  accentImage: string;
}

export interface CoachCard {
  id: string;
  slug: string;
  headline: string;
  specialties: string[];
  languages: string[];
  yearsExperience: number;
  ratingTenths: number;
  reviewCount: number;
  clientCount: number;
  availableSlotsThisWeek: number;
  monthlyPriceCents: number;
  imageKey: string;
  acceptingClients: boolean;
  firstName: string;
  lastName: string;
  matchScore?: number;
  matchReasons?: string[];
}

export interface Recipe {
  id: string;
  slug: string;
  name: string;
  summary: string;
  slot: string;
  calories: number;
  proteinGrams: number;
  carbGrams: number;
  fatGrams: number;
  fibreGrams: number;
  prepMinutes: number;
  cookMinutes: number;
  difficulty: string;
  servings: number;
  tags: string[];
  instructions: string[];
  imageKey: string;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  category: string;
  summary: string;
  description: string;
  priceCents: number;
  compareAtCents: number | null;
  financingMonths: number;
  ratingTenths: number;
  reviewCount: number;
  compatiblePrograms: string[];
  goals: string[];
  warranty: string;
  shipping: string;
  inStock: boolean;
  imageKey: string;
}

export interface Article {
  id: string;
  slug: string;
  title: string;
  category: string;
  excerpt: string;
  body?: string;
  authorName: string;
  authorRole: string;
  readMinutes: number;
  featured: boolean;
  imageKey: string;
  publishedOn: string;
}

export interface PlanTierDefinition {
  tier: 'forge' | 'forge-pro' | 'forge-coach';
  name: string;
  tagline: string;
  monthlyPriceCents: number;
  startingAt: boolean;
  highlight: boolean;
  badge?: string;
  features: string[];
  cta: string;
  trialDays: number;
  pricing: {
    monthlyCents: number;
    yearlyCents: number;
    yearlyMonthlyEquivalentCents: number;
    yearlySavingCents: number;
    yearlySavingPercent: number;
  };
}

export interface AiAnswer {
  intent: string;
  headline: string;
  body: string[];
  actions: { label: string; action: string }[];
  sources: string[];
  disclaimer?: string;
}
