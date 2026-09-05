'use client';

import { useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';

/**
 * The interactive assessment card on the homepage.
 *
 * A real three-question preview rather than a picture of one: answering it
 * carries the answers into the full assessment via the query string, so the
 * visitor never re-answers what they already told us. That is the difference
 * between a marketing section and the top of the funnel.
 */

const STEPS = [
  {
    key: 'goal',
    question: "What's your main goal?",
    options: [
      { value: 'build-muscle', label: 'Build Muscle' },
      { value: 'lose-body-fat', label: 'Lose Body Fat' },
      { value: 'improve-strength', label: 'Improve Strength' },
      { value: 'improve-endurance', label: 'Improve Endurance' },
      { value: 'build-healthy-habits', label: 'Build Healthy Habits' },
      { value: 'improve-mobility', label: 'Improve Mobility' },
      { value: 'train-for-competition', label: 'Train for Competition' },
    ],
  },
  {
    key: 'experience',
    question: 'Experience level',
    options: [
      { value: 'beginner', label: 'Beginner' },
      { value: 'intermediate', label: 'Intermediate' },
      { value: 'advanced', label: 'Advanced' },
    ],
  },
  {
    key: 'location',
    question: 'Where do you train?',
    options: [
      { value: 'home', label: 'Home' },
      { value: 'gym', label: 'Gym' },
      { value: 'both', label: 'Both' },
      { value: 'outside', label: 'Outside' },
    ],
  },
  {
    key: 'equipment',
    question: 'Available equipment',
    multi: true,
    options: [
      { value: 'bodyweight', label: 'Bodyweight' },
      { value: 'dumbbells', label: 'Dumbbells' },
      { value: 'barbell', label: 'Barbell' },
      { value: 'bench', label: 'Bench' },
      { value: 'kettlebell', label: 'Kettlebell' },
      { value: 'resistance-bands', label: 'Resistance Bands' },
      { value: 'cable-machine', label: 'Cable Machine' },
      { value: 'full-gym', label: 'Full Gym' },
      { value: 'cardio-equipment', label: 'Cardio Equipment' },
    ],
  },
] as const;

export function AssessmentPreview() {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});

  const select = (key: string, value: string, multi: boolean) => {
    setAnswers((current) => {
      const existing = current[key] ?? [];
      if (!multi) return { ...current, [key]: existing[0] === value ? [] : [value] };
      return {
        ...current,
        [key]: existing.includes(value) ? existing.filter((v) => v !== value) : [...existing, value],
      };
    });
  };

  const query = new URLSearchParams();
  for (const [key, values] of Object.entries(answers)) {
    if (values.length > 0) query.set(key, values.join(','));
  }
  const answered = Object.values(answers).filter((v) => v.length > 0).length;

  return (
    <div className="light-surface rounded-card border border-ink-900/10 bg-bone-100 p-6 shadow-card sm:p-8">
      <div className="flex items-center justify-between gap-4">
        <p className="eyebrow">Build my plan</p>
        <p className="text-xs tabular-nums text-muted">{answered} / {STEPS.length}</p>
      </div>

      <div className="mt-6 space-y-7">
        {STEPS.map((step) => {
          const selected = answers[step.key] ?? [];
          const multi = 'multi' in step && step.multi === true;
          return (
            <fieldset key={step.key}>
              <legend className="mb-3 text-sm font-semibold">{step.question}</legend>
              <div className="flex flex-wrap gap-2">
                {step.options.map((option) => {
                  const active = selected.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => select(step.key, option.value, multi)}
                      className={clsx(
                        'min-h-[44px] rounded-pill border px-4 text-xs font-medium transition-all duration-200 ease-forge',
                        active
                          ? 'border-ember bg-ember-600 text-bone-100 shadow-card'
                          : 'border-ink-900/15 hover:border-ink-900/40 hover:bg-ink-900/[0.03]',
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>

      <Link
        href={`/assessment${query.toString() ? `?${query.toString()}` : ''}`}
        className="dark-surface mt-8 flex min-h-[56px] w-full items-center justify-center rounded-[10px] bg-ink-900 px-8 text-sm font-semibold uppercase tracking-[0.08em] text-bone-100 shadow-card transition-all duration-200 hover:bg-ink-700 hover:shadow-lift active:translate-y-px"
      >
        Build My Plan
      </Link>
      <p className="mt-3 text-center text-xs text-muted">
        Ten questions, about two minutes. No card needed to see your plan.
      </p>
    </div>
  );
}
