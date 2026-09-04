'use client';

import { useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { Toggle } from '@/components/ui/forms';
import { formatCents } from '@/lib/format';
import type { PlanTierDefinition } from '@/lib/types';

/**
 * Pricing cards.
 *
 * The yearly saving is computed from the same numbers the API returns rather
 * than typed into the copy, so the badge can never claim a discount that
 * checkout does not apply.
 */
export function PricingTable({ plans }: { plans: PlanTierDefinition[] }) {
  const [yearly, setYearly] = useState(false);

  return (
    <div>
      <div className="flex flex-col items-center gap-4">
        <Toggle checked={yearly} onChange={setYearly} labels={['Monthly', 'Yearly']} />
        <p className="text-xs opacity-60">
          {yearly
            ? `Save up to ${Math.max(...plans.map((p) => p.pricing.yearlySavingPercent))}% paying yearly`
            : 'Switch to yearly to see the discount'}
        </p>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-3">
        {plans.map((plan) => {
          const price = yearly ? plan.pricing.yearlyMonthlyEquivalentCents : plan.pricing.monthlyCents;
          return (
            <article
              key={plan.tier}
              className={clsx(
                'relative flex flex-col rounded-card border p-7 transition-all duration-300 ease-forge sm:p-8',
                plan.highlight
                  ? 'dark-surface border-ink-900 bg-ink-900 text-bone-200 shadow-lift lg:-my-4 lg:py-12'
                  : 'border-ink-900/12 bg-bone-100 hover:shadow-card',
              )}
            >
              {plan.badge && (
                <span className="absolute -top-3 left-7 rounded-pill bg-ember px-3 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-bone-100">
                  {plan.badge}
                </span>
              )}

              <h2 className="display text-2xl">{plan.name}</h2>
              <p className="mt-2 text-sm opacity-65">{plan.tagline}</p>

              <div className="mt-7">
                <p className="flex items-baseline gap-1.5">
                  {plan.startingAt && <span className="text-xs uppercase tracking-[0.1em] opacity-55">from</span>}
                  <span className="display text-display-sm tabular-nums">{formatCents(price)}</span>
                  <span className="text-sm opacity-55">/ month</span>
                </p>
                {yearly && (
                  <p className="mt-2 text-xs opacity-60">
                    {formatCents(plan.pricing.yearlyCents)} billed yearly —{' '}
                    <span className="text-ember">save {formatCents(plan.pricing.yearlySavingCents)}</span>
                  </p>
                )}
                {!yearly && plan.trialDays > 0 && (
                  <p className="mt-2 text-xs opacity-60">{plan.trialDays}-day free trial included</p>
                )}
              </div>

              <Link
                href={`/signup?plan=${plan.tier}&interval=${yearly ? 'yearly' : 'monthly'}`}
                className={clsx(
                  'mt-7 flex min-h-[52px] items-center justify-center rounded-[10px] px-6 text-xs font-semibold uppercase tracking-[0.1em] transition-all duration-200',
                  plan.highlight
                    ? 'bg-ember text-bone-100 hover:bg-ember-600'
                    : 'bg-ink-900 text-bone-100 hover:bg-ink-700',
                )}
              >
                {plan.cta}
              </Link>

              <ul className="mt-8 space-y-3">
                {plan.tier !== 'forge' && (
                  <li className="pb-1 text-xs font-semibold uppercase tracking-[0.1em] opacity-55">
                    Everything in {plan.tier === 'forge-pro' ? 'FORGE' : 'FORGE PRO'}, plus:
                  </li>
                )}
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-3 text-sm leading-relaxed">
                    <span aria-hidden className="mt-0.5 shrink-0 text-ember">✓</span>
                    <span className="opacity-80">{feature}</span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </div>
  );
}
