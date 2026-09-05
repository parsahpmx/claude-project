'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { Button, Card, Chip } from '@/components/ui/primitives';
import { TextInput, Toggle, Checkbox } from '@/components/ui/forms';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { formatCents } from '@/lib/format';
import type { PlanTierDefinition } from '@/lib/types';

/**
 * Account creation and checkout, in one screen.
 *
 * The recurring-billing disclosure is fetched from the API rather than written
 * in the UI, so the sentence a member agrees to is generated from the same
 * numbers that will actually be charged. Copy and price cannot drift apart.
 */

interface CheckoutSummary {
  planName: string;
  interval: 'monthly' | 'yearly';
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  trialDays: number;
  disclosure: string;
  firstChargeDate: string;
}

type Method = 'card' | 'apple-pay' | 'google-pay';

export function CheckoutFlow({
  plans,
  initialTier,
  initialInterval,
  answers,
  programSlug,
  coachSlug,
}: {
  plans: PlanTierDefinition[];
  initialTier: string;
  initialInterval: 'monthly' | 'yearly';
  answers: Record<string, string[]>;
  programSlug: string | null;
  coachSlug: string | null;
}) {
  const router = useRouter();
  const [tier, setTier] = useState(plans.some((p) => p.tier === initialTier) ? initialTier : 'forge-pro');
  const [interval, setInterval] = useState<'monthly' | 'yearly'>(initialInterval);
  const [promo, setPromo] = useState('');
  const [appliedPromo, setAppliedPromo] = useState('');
  const [promoError, setPromoError] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>('card');
  const [summary, setSummary] = useState<CheckoutSummary | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const plan = plans.find((p) => p.tier === tier);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const response = await fetch('/api/v1/checkout/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier, interval, ...(appliedPromo ? { promoCode: appliedPromo } : {}) }),
      });
      if (cancelled) return;
      if (!response.ok) {
        setSummary(null);
        return;
      }
      const body = (await response.json()) as { summary: CheckoutSummary };
      setSummary(body.summary);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [tier, interval, appliedPromo]);

  const applyPromo = async () => {
    setPromoError(null);
    const response = await fetch('/api/v1/checkout/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tier, interval, promoCode: promo }),
    });
    if (!response.ok) {
      setPromoError('That promotion code is not recognised.');
      return;
    }
    setAppliedPromo(promo.trim().toUpperCase());
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next: Record<string, string> = {};

    const firstName = String(form.get('firstName') ?? '').trim();
    const lastName = String(form.get('lastName') ?? '').trim();
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');

    if (!firstName) next.firstName = 'We need a first name for your plan.';
    if (!lastName) next.lastName = 'We need a last name for your account.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) next.email = 'That does not look like an email address.';
    if (password.length < 10) next.password = 'Use at least 10 characters. Length beats symbols.';
    if (!accepted) next.accepted = 'Please confirm you understand when billing starts.';

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setPending(true);
    setSubmitError(null);

    const payload: Record<string, unknown> = {
      email, password, firstName, lastName, tier, billingInterval: interval,
      ...(appliedPromo ? { promoCode: appliedPromo } : {}),
    };

    if (answers.primaryGoal) {
      payload.answers = {
        primaryGoal: answers.primaryGoal[0],
        secondaryGoals: answers.secondaryGoals ?? [],
        ageRange: answers.ageRange?.[0] ?? '25-34',
        experience: answers.experience?.[0] ?? 'beginner',
        daysPerWeek: Number(answers.daysPerWeek?.[0] ?? 3),
        sessionMinutes: Number(answers.sessionMinutes?.[0] ?? 45),
        location: answers.location?.[0] ?? 'gym',
        equipment: answers.equipment ?? ['bodyweight'],
        diet: answers.diet?.[0] ?? 'balanced',
        coaching: answers.coaching?.[0] ?? 'ai-assisted',
      };
    }

    try {
      const response = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setSubmitError(body.error?.message ?? 'We could not create your account.');
        setPending(false);
        return;
      }
      const next = programSlug ? `/app/onboarding?program=${programSlug}` : '/app';
      router.push(coachSlug ? `${next}${next.includes('?') ? '&' : '?'}coach=${coachSlug}` : next);
      router.refresh();
    } catch {
      setSubmitError('We could not reach the server. Your details have not been submitted.');
      setPending(false);
    }
  };

  return (
    <div className="shell py-12 sm:py-16">
      <div className="mx-auto max-w-5xl">
        <p className="eyebrow mb-5">Checkout</p>
        <h1 className="display text-display-md text-balance">START YOUR FREE TRIAL.</h1>

        <div className="mt-12 grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:gap-14">
          {/* ------------------------------------------------ form */}
          <form onSubmit={submit} noValidate className="space-y-10">
            {submitError && <ErrorState title="We could not create your account" body={submitError} />}

            <section>
              <p className="eyebrow mb-5">01 — Your details</p>
              <div className="dark-surface grid gap-5 sm:grid-cols-2 [&_input]:border-bone-200/20 [&_input]:bg-ink-800 [&_input]:text-bone-100 [&_label]:text-bone-200/70">
                <TextInput label="First name" name="firstName" required autoComplete="given-name" error={errors.firstName} />
                <TextInput label="Last name" name="lastName" required autoComplete="family-name" error={errors.lastName} />
                <div className="sm:col-span-2">
                  <TextInput label="Email" name="email" type="email" required autoComplete="email" error={errors.email} />
                </div>
                <div className="sm:col-span-2">
                  <TextInput
                    label="Password"
                    name="password"
                    type="password"
                    required
                    autoComplete="new-password"
                    error={errors.password}
                    hint="At least 10 characters. A passphrase beats a symbol soup."
                  />
                </div>
              </div>
            </section>

            <section>
              <p className="eyebrow mb-5">02 — Your plan</p>
              <div className="mb-5"><Toggle checked={interval === 'yearly'} onChange={(v) => setInterval(v ? 'yearly' : 'monthly')} labels={['Monthly', 'Yearly']} /></div>
              <div className="grid gap-3">
                {plans.map((option) => {
                  const active = option.tier === tier;
                  const price = interval === 'yearly' ? option.pricing.yearlyMonthlyEquivalentCents : option.pricing.monthlyCents;
                  return (
                    <label
                      key={option.tier}
                      className={clsx(
                        'flex cursor-pointer items-start justify-between gap-4 rounded-card border p-5 transition-all duration-200',
                        active ? 'accent-tint border-ember bg-ember/[0.08]' : 'dark-surface border-bone-200/12 bg-ink-800 hover:border-bone-200/30',
                      )}
                    >
                      <span className="flex items-start gap-4">
                        <input
                          type="radio"
                          name="tier"
                          value={option.tier}
                          checked={active}
                          onChange={() => setTier(option.tier)}
                          className="sr-only"
                        />
                        <span
                          aria-hidden
                          className={clsx(
                            'mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[0.625rem]',
                            active ? 'border-ember bg-ember-600 text-bone-100' : 'border-bone-200/30',
                          )}
                        >
                          {active ? '✓' : ''}
                        </span>
                        <span>
                          <span className="flex items-center gap-2 font-semibold text-bone-100">
                            {option.name}
                            {option.badge && <Chip tone="accent" size="sm">{option.badge}</Chip>}
                          </span>
                          <span className="mt-1 block text-xs text-bone-200/55">{option.tagline}</span>
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-semibold tabular-nums text-bone-100">{formatCents(price)}</span>
                        <span className="block text-[0.6875rem] text-muted">/ month</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>

            <section>
              <p className="eyebrow mb-5">03 — Payment method</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {([
                  ['apple-pay', 'Apple Pay'],
                  ['google-pay', 'Google Pay'],
                  ['card', 'Credit Card'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={method === value}
                    onClick={() => setMethod(value)}
                    className={clsx(
                      'min-h-[56px] rounded-[10px] border text-sm font-medium transition-all duration-200',
                      method === value
                        ? 'border-ember bg-ember-600/[0.08] text-bone-100'
                        : 'dark-surface border-bone-200/15 bg-ink-800 text-bone-200/70 hover:border-bone-200/35',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {method === 'card' && (
                <div className="dark-surface mt-5 rounded-card border border-bone-200/12 bg-ink-800 p-5">
                  <p className="text-xs leading-relaxed text-bone-200/55">
                    Card details are collected by the payment processor, not by FORGE. This prototype does not
                    take real payments — no card is charged and none is stored.
                  </p>
                </div>
              )}
            </section>

            <section>
              <p className="eyebrow mb-5">04 — Confirm</p>
              <div className="[&_label]:text-bone-200/80">
                <Checkbox
                  label={summary?.disclosure ?? 'Loading billing terms…'}
                  checked={accepted}
                  onChange={setAccepted}
                />
              </div>
              {errors.accepted && (
                <p role="alert" className="mt-3 text-xs text-status-bad">
                  <span aria-hidden>!</span> {errors.accepted}
                </p>
              )}

              <div className="mt-8">
                <Button type="submit" size="lg" block disabled={pending || !summary}>
                  {pending ? 'Creating your account…' : 'Start My Free Trial'}
                </Button>
              </div>
              <p className="mt-3 text-center text-xs text-muted">
                Cancel anytime · Secure payments · No hidden fees
              </p>
            </section>
          </form>

          {/* ------------------------------------------------ summary */}
          <aside aria-label="Order summary" className="lg:sticky lg:top-8 lg:self-start">
            <Card tone="dark">
              <p className="eyebrow mb-5">Order summary</p>

              {!summary ? (
                <div className="space-y-3">
                  <Skeleton className="h-5 w-1/2 bg-bone-200/10" />
                  <Skeleton className="h-5 w-2/3 bg-bone-200/10" />
                  <Skeleton className="h-12 w-full bg-bone-200/10" />
                </div>
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-bone-100">{summary.planName}</span>
                    <span className="tabular-nums text-bone-200/70">{formatCents(summary.subtotalCents)}</span>
                  </div>
                  <p className="mt-1 text-xs capitalize text-muted">Billed {summary.interval}</p>

                  {summary.discountCents > 0 && (
                    <div className="mt-4 flex items-baseline justify-between gap-4 text-status-good">
                      <span className="text-sm">Promotion {appliedPromo}</span>
                      <span className="tabular-nums">−{formatCents(summary.discountCents)}</span>
                    </div>
                  )}

                  <div className="rule my-6" />

                  <div className="space-y-3">
                    <div className="flex items-end gap-2">
                      <input
                        aria-label="Promotion code"
                        value={promo}
                        onChange={(event) => setPromo(event.target.value)}
                        placeholder="Promo code"
                        className="dark-surface min-h-[44px] w-full rounded-[8px] border border-bone-200/20 bg-ink-900 px-4 text-sm text-bone-100 placeholder:text-muted"
                      />
                      <Button type="button" variant="ghost" size="sm" onClick={() => void applyPromo()}>
                        Apply
                      </Button>
                    </div>
                    {promoError && (
                      <p role="alert" className="text-xs text-status-bad">
                        <span aria-hidden>!</span> {promoError}
                      </p>
                    )}
                  </div>

                  <div className="rule my-6" />

                  <div className="flex items-baseline justify-between gap-4">
                    <span className="display text-lg">Due today</span>
                    <span className="display text-2xl tabular-nums">
                      {summary.trialDays > 0 ? formatCents(0) : formatCents(summary.totalCents)}
                    </span>
                  </div>

                  {summary.trialDays > 0 && (
                    <p className="mt-3 text-xs leading-relaxed text-bone-200/55">
                      {formatCents(summary.totalCents)} charged on {summary.firstChargeDate}, after your{' '}
                      {summary.trialDays}-day free trial.
                    </p>
                  )}
                </>
              )}

              {plan && (
                <>
                  <div className="rule my-6" />
                  <p className="eyebrow mb-4">Included</p>
                  <ul className="space-y-2.5">
                    {plan.features.slice(0, 6).map((feature) => (
                      <li key={feature} className="flex gap-3 text-xs">
                        <span aria-hidden className="text-accent">✓</span>
                        <span className="text-bone-200/70">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>

            {coachSlug && (
              <div className="mt-5">
                <Card tone="dark">
                  <p className="eyebrow mb-2">Your coach</p>
                  <p className="text-sm text-bone-200/75">
                    We will connect you with <span className="text-bone-100">{coachSlug.replace(/-/g, ' ')}</span>{' '}
                    as soon as your account is created.
                  </p>
                </Card>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
