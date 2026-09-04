import type { PlanTier } from './types.js';

/**
 * Subscription plans.
 *
 * Prices are integer cents. Yearly is derived from monthly by a stated
 * discount rather than typed twice, so the saving shown on the pricing page is
 * arithmetically the saving the member gets — a mismatch there is a consumer
 * protection problem, not a copy bug.
 */

export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  tagline: string;
  monthlyPriceCents: number;
  /** Applied to twelve months of the monthly price. */
  yearlyDiscount: number;
  startingAt: boolean;
  highlight: boolean;
  badge?: string;
  features: string[];
  inheritsFrom?: PlanTier;
  cta: string;
  trialDays: number;
}

export const PLANS: PlanDefinition[] = [
  {
    tier: 'forge',
    name: 'FORGE',
    tagline: 'The complete personalised training system.',
    monthlyPriceCents: 2900,
    yearlyDiscount: 0.2,
    startingAt: false,
    highlight: false,
    trialDays: 7,
    cta: 'Start Free Trial',
    features: [
      'Personalised training plan built from your assessment',
      '500+ workouts across eleven training styles',
      'Every programme in the library',
      'Nutrition targets, meal plans and recipes',
      'Recovery, mobility and breathwork sessions',
      'Progress analytics and personal records',
      'Community feed and challenges',
      'FORGE AI training assistant',
    ],
  },
  {
    tier: 'forge-pro',
    name: 'FORGE PRO',
    tagline: 'Adaptive training with performance data underneath it.',
    monthlyPriceCents: 4900,
    yearlyDiscount: 0.2,
    startingAt: false,
    highlight: true,
    badge: 'Most Popular',
    inheritsFrom: 'forge',
    trialDays: 7,
    cta: 'Start Free Trial',
    features: [
      'Advanced analytics with strength and load modelling',
      'Adaptive training that adjusts to your readiness daily',
      'Advanced nutrition with meal-level macro targeting',
      'Priority access to new programmes',
      'Wearable insights across sleep, HRV and recovery',
      'AI performance analysis on every completed session',
    ],
  },
  {
    tier: 'forge-coach',
    name: 'FORGE COACH',
    tagline: 'A certified coach who knows your name and your numbers.',
    monthlyPriceCents: 14900,
    yearlyDiscount: 0.15,
    startingAt: true,
    highlight: false,
    inheritsFrom: 'forge-pro',
    trialDays: 0,
    cta: 'Find My Coach',
    features: [
      'A dedicated human coach matched to your goal',
      'A training plan written for you, not generated',
      'Weekly check-ins with written feedback',
      'Direct messaging with your coach',
      'Video form review with timestamped notes',
      'Monthly 1-to-1 video session',
    ],
  },
];

export function findPlan(tier: PlanTier): PlanDefinition | undefined {
  return PLANS.find((p) => p.tier === tier);
}

export interface PlanPricing {
  monthlyCents: number;
  yearlyCents: number;
  yearlyMonthlyEquivalentCents: number;
  yearlySavingCents: number;
  yearlySavingPercent: number;
}

export function planPricing(plan: PlanDefinition): PlanPricing {
  const yearlyFull = plan.monthlyPriceCents * 12;
  const yearlyCents = Math.round((yearlyFull * (1 - plan.yearlyDiscount)) / 100) * 100;
  return {
    monthlyCents: plan.monthlyPriceCents,
    yearlyCents,
    yearlyMonthlyEquivalentCents: Math.round(yearlyCents / 12),
    yearlySavingCents: yearlyFull - yearlyCents,
    yearlySavingPercent: Math.round(plan.yearlyDiscount * 100),
  };
}

export function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Everything a tier includes, walking the inheritance chain. */
export function effectiveFeatures(tier: PlanTier): string[] {
  const plan = findPlan(tier);
  if (!plan) return [];
  const inherited = plan.inheritsFrom ? effectiveFeatures(plan.inheritsFrom) : [];
  return [...inherited, ...plan.features];
}

export const ENTITLEMENTS = {
  forge: ['training', 'nutrition', 'recovery', 'community', 'challenges', 'ai-basic', 'progress'],
  'forge-pro': ['analytics-advanced', 'adaptive-training', 'wearables', 'ai-analysis'],
  'forge-coach': ['human-coach', 'form-review', 'video-sessions', 'coach-messaging'],
} as const satisfies Record<PlanTier, readonly string[]>;

export function entitlementsFor(tier: PlanTier): string[] {
  const plan = findPlan(tier);
  if (!plan) return [];
  const inherited = plan.inheritsFrom ? entitlementsFor(plan.inheritsFrom) : [];
  return [...inherited, ...ENTITLEMENTS[tier]];
}

export function hasEntitlement(tier: PlanTier, entitlement: string): boolean {
  return entitlementsFor(tier).includes(entitlement);
}

export interface CheckoutSummary {
  planName: string;
  interval: 'monthly' | 'yearly';
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  trialDays: number;
  /** Renders as the recurring-billing disclosure required at checkout. */
  disclosure: string;
  firstChargeDate: string;
}

export function summariseCheckout(input: {
  tier: PlanTier;
  interval: 'monthly' | 'yearly';
  promoPercentOff?: number;
  todayIso: string;
}): CheckoutSummary | null {
  const plan = findPlan(input.tier);
  if (!plan) return null;
  const pricing = planPricing(plan);

  const subtotal = input.interval === 'yearly' ? pricing.yearlyCents : pricing.monthlyCents;
  const promo = Math.round(subtotal * ((input.promoPercentOff ?? 0) / 100));
  const total = Math.max(0, subtotal - promo);

  const trialEnd = new Date(input.todayIso);
  trialEnd.setUTCDate(trialEnd.getUTCDate() + plan.trialDays);
  const firstChargeDate = trialEnd.toISOString().slice(0, 10);

  const cadence = input.interval === 'yearly' ? 'year' : 'month';
  const disclosure =
    plan.trialDays > 0
      ? `Your ${plan.trialDays}-day free trial ends on ${firstChargeDate}. You will then be charged ${formatCents(total)} per ${cadence} until you cancel. Cancel any time before ${firstChargeDate} and you will not be charged.`
      : `You will be charged ${formatCents(total)} per ${cadence}, starting today, until you cancel.`;

  return {
    planName: plan.name,
    interval: input.interval,
    subtotalCents: subtotal,
    discountCents: promo,
    totalCents: total,
    trialDays: plan.trialDays,
    disclosure,
    firstChargeDate,
  };
}

export const PROMO_CODES: Record<string, number> = {
  FORGE20: 20,
  BUILD10: 10,
};

export function resolvePromo(code: string | undefined): number {
  if (!code) return 0;
  return PROMO_CODES[code.trim().toUpperCase()] ?? 0;
}
