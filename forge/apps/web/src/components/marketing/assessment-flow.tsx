'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { Button, ButtonLink, Card, Chip, Stat } from '@/components/ui/primitives';
import { ChoiceCard } from '@/components/ui/forms';
import { ErrorState, Skeleton } from '@/components/ui/feedback';

/**
 * The ten-step assessment.
 *
 * The whole funnel is one client component holding one answer object. Routing
 * each step through the URL would look tidier and would lose a member's answers
 * every time they hit back — which is the single most expensive bug a signup
 * funnel can have.
 */

interface Step {
  id: string;
  index: number;
  eyebrow: string;
  question: string;
  helper: string;
  kind: 'single' | 'multi' | 'number';
  options: { value: string; label: string; description?: string }[];
  optional: boolean;
}

interface Profile {
  trainingLevel: string;
  suggestedFrequency: number;
  sessionMinutes: number;
  trainingFocus: string;
  recoveryPriority: string;
  nutritionGoal: string;
  recommendedProgramSlug: string;
  recommendedProgramName: string;
  readinessForVolume: number;
  progressionType: string;
  rationale: string[];
  phaseEmphasis: Record<string, string>;
}

interface Result {
  profile: Profile;
  recommendedTier: string;
  program: { slug: string; name: string; tagline: string; weeks: number; sessionsPerWeek: number; summary: string } | null;
}

const NUMERIC_STEPS = new Set(['daysPerWeek', 'sessionMinutes']);

export function AssessmentFlow({ steps, prefill }: { steps: Step[]; prefill: Record<string, string[]> }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>(prefill);
  const [state, setState] = useState<'answering' | 'submitting' | 'done' | 'error'>('answering');
  const [result, setResult] = useState<Result | null>(null);

  const step = steps[index];
  const selected = step ? answers[step.id] ?? [] : [];
  const canAdvance = step ? step.optional || selected.length > 0 : false;

  const progress = useMemo(() => Math.round(((index + (state === 'done' ? 1 : 0)) / steps.length) * 100), [index, steps.length, state]);

  const choose = (value: string) => {
    if (!step) return;
    setAnswers((current) => {
      const existing = current[step.id] ?? [];
      if (step.kind === 'multi') {
        return {
          ...current,
          [step.id]: existing.includes(value) ? existing.filter((v) => v !== value) : [...existing, value],
        };
      }
      return { ...current, [step.id]: [value] };
    });
  };

  const submit = async (finalAnswers: Record<string, string[]>) => {
    setState('submitting');
    const payload = {
      primaryGoal: finalAnswers.primaryGoal?.[0],
      secondaryGoals: finalAnswers.secondaryGoals ?? [],
      ageRange: finalAnswers.ageRange?.[0],
      experience: finalAnswers.experience?.[0],
      daysPerWeek: Number(finalAnswers.daysPerWeek?.[0] ?? 3),
      sessionMinutes: Number(finalAnswers.sessionMinutes?.[0] ?? 45),
      location: finalAnswers.location?.[0],
      equipment: finalAnswers.equipment ?? ['bodyweight'],
      diet: finalAnswers.diet?.[0],
      coaching: finalAnswers.coaching?.[0],
    };

    try {
      const response = await fetch('/api/v1/assessment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers: payload }),
      });
      if (!response.ok) throw new Error('assessment failed');
      setResult((await response.json()) as Result);
      setState('done');
    } catch {
      setState('error');
    }
  };

  const next = () => {
    if (index < steps.length - 1) {
      setIndex(index + 1);
      return;
    }
    void submit(answers);
  };

  if (state === 'done' && result) {
    return <AssessmentResult result={result} answers={answers} />;
  }

  return (
    <div className="shell py-12 sm:py-20">
      <div className="mx-auto max-w-3xl">
        {/* progress */}
        <div className="mb-12">
          <div className="flex items-baseline justify-between">
            <p className="eyebrow">{step?.eyebrow ?? 'Building your plan'}</p>
            <p className="text-xs tabular-nums text-bone-200/50">
              {Math.min(index + 1, steps.length)} / {steps.length}
            </p>
          </div>
          <div
            className="mt-3 h-0.5 w-full overflow-hidden rounded-pill bg-bone-200/10"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Assessment progress"
          >
            <div className="h-full rounded-pill bg-ember transition-[width] duration-500 ease-forge" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {state === 'error' && (
          <div className="mb-8">
            <ErrorState
              title="We could not build your profile"
              body="Your answers are safe. Try again — if it keeps failing, the assessment service is likely down rather than anything you did."
              action={<Button onClick={() => void submit(answers)}>Try again</Button>}
            />
          </div>
        )}

        {state === 'submitting' ? (
          <div className="space-y-4">
            <p className="display text-display-sm">BUILDING YOUR PROFILE…</p>
            <Skeleton className="h-6 w-2/3 bg-bone-200/10" />
            <Skeleton className="h-6 w-1/2 bg-bone-200/10" />
            <Skeleton className="h-40 w-full bg-bone-200/10" />
          </div>
        ) : step ? (
          <div key={step.id} className="animate-fade-up">
            <h1 className="display text-display-md text-balance">{step.question}</h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-bone-200/60">{step.helper}</p>

            <fieldset className="mt-10">
              <legend className="sr-only">{step.question}</legend>
              <div
                className={clsx(
                  'grid gap-3',
                  step.options.length > 6 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2',
                )}
              >
                {step.options.map((option) => (
                  <div key={option.value} className="[&_label]:border-bone-200/15 [&_label]:bg-ink-800 [&_label]:text-bone-200">
                    <ChoiceCard
                      name={step.id}
                      value={option.value}
                      label={option.label}
                      {...(option.description ? { description: option.description } : {})}
                      checked={selected.includes(option.value)}
                      onChange={choose}
                      multi={step.kind === 'multi'}
                    />
                  </div>
                ))}
              </div>
            </fieldset>

            {step.optional && selected.length === 0 && (
              <p className="mt-5 text-xs text-bone-200/45">This one is optional — skip it if nothing applies.</p>
            )}
            {NUMERIC_STEPS.has(step.id) && (
              <p className="mt-5 text-xs text-bone-200/45">
                You can change this later without losing your plan.
              </p>
            )}

            <div className="mt-12 flex items-center justify-between gap-4">
              <Button
                variant="ghost"
                onClick={() => setIndex(Math.max(0, index - 1))}
                disabled={index === 0}
              >
                ← Back
              </Button>
              <Button onClick={next} size="lg" disabled={!canAdvance}>
                {index === steps.length - 1 ? 'See My Profile' : 'Continue'}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AssessmentResult({ result, answers }: { result: Result; answers: Record<string, string[]> }) {
  const { profile, program, recommendedTier } = result;
  const query = new URLSearchParams({ plan: recommendedTier, program: profile.recommendedProgramSlug });
  for (const [key, values] of Object.entries(answers)) {
    if (values.length > 0) query.set(key, values.join(','));
  }

  return (
    <div className="shell py-12 sm:py-20">
      <div className="mx-auto max-w-4xl animate-fade-up">
        <p className="eyebrow mb-5">Assessment complete</p>
        <h1 className="display text-display-lg text-balance">YOUR PERFORMANCE PROFILE IS READY.</h1>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <Card tone="dark">
            <dl className="grid gap-7 sm:grid-cols-2">
              <Stat label="Training level" value={capitalise(profile.trainingLevel)} tone="dark" />
              <Stat label="Suggested frequency" value={`${profile.suggestedFrequency}× / week`} tone="dark" />
              <Stat label="Training focus" value={profile.trainingFocus} tone="dark" />
              <Stat label="Recovery priority" value={capitalise(profile.recoveryPriority)} tone="dark" />
              <Stat label="Nutrition goal" value={profile.nutritionGoal} tone="dark" />
              <Stat label="Session length" value={`${profile.sessionMinutes} min`} tone="dark" />
            </dl>

            <div className="rule my-8" />

            <p className="eyebrow mb-4">Why this plan</p>
            <ul className="space-y-3">
              {profile.rationale.map((reason) => (
                <li key={reason} className="flex gap-3 text-sm">
                  <span aria-hidden className="text-ember">→</span>
                  <span className="text-bone-200/75">{reason}</span>
                </li>
              ))}
            </ul>
          </Card>

          <div className="space-y-6">
            <Card tone="dark">
              <p className="eyebrow mb-3">Recommended programme</p>
              <p className="display text-2xl leading-none text-bone-100">{profile.recommendedProgramName}</p>
              {program && (
                <>
                  <p className="mt-3 text-sm text-bone-200/65">{program.tagline}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Chip tone="inverse" size="sm">{program.weeks} weeks</Chip>
                    <Chip tone="inverse" size="sm">{program.sessionsPerWeek} days / week</Chip>
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-bone-200/60">{program.summary}</p>
                </>
              )}
              <div className="mt-6">
                <ButtonLink href={`/programs/${profile.recommendedProgramSlug}`} variant="inverse" size="sm" block>
                  See the full programme
                </ButtonLink>
              </div>
            </Card>

            <Card tone="dark">
              <p className="eyebrow mb-4">Your twelve weeks</p>
              <ol className="space-y-4">
                {(['foundation', 'build', 'perform'] as const).map((phase, i) => (
                  <li key={phase}>
                    <p className="text-xs uppercase tracking-[0.12em] text-ember">Phase 0{i + 1} · {phase}</p>
                    <p className="mt-1 text-sm text-bone-200/70">{profile.phaseEmphasis[phase]}</p>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href={`/signup?${query.toString()}`} size="lg">Create My Account</ButtonLink>
          <ButtonLink href="/pricing" variant="inverse" size="lg">Compare Plans</ButtonLink>
        </div>
        <p className="mt-5 text-xs text-bone-200/45">
          Seven-day free trial. Cancel any time before it ends and you are not charged.
        </p>

        <p className="mt-10 max-w-prose text-xs leading-relaxed text-bone-200/40">
          This profile is a training recommendation, not medical advice. If you have an injury, a medical
          condition, or you are pregnant or post-natal, speak to a qualified healthcare professional before
          starting any programme. <Link href="/coaching" className="underline">A FORGE coach</Link> can work
          alongside them.
        </p>
      </div>
    </div>
  );
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
