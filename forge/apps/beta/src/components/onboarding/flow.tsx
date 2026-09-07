'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import type { Sport, Visibility } from '@forge/contracts';
import { Button } from '@/components/ui/primitives';
import { Field } from '@/components/ui/field';
import { completeOnboarding } from '@/app/onboarding/actions';

/**
 * Five questions, one per screen.
 *
 * A long form asked all at once gets abandoned; one decision at a time with
 * visible progress does not. Every answer changes something real — the sports
 * picked set the primary sport, the visibility answer sets the account default
 * — so none of this is asked for the sake of asking.
 */

const EXPERIENCE = [
  {
    value: 'beginner' as const,
    title: 'Beginner',
    body: 'New to training, or coming back after a break.',
  },
  {
    value: 'intermediate' as const,
    title: 'Intermediate',
    body: 'Training regularly and comfortable with the basics.',
  },
  {
    value: 'advanced' as const,
    title: 'Advanced',
    body: 'Structured training is already part of my week.',
  },
];

const GOALS = [
  'Build an exercise habit',
  'Get stronger',
  'Run further',
  'Run faster',
  'Train for an event',
  'Stay healthy',
  'Explore new places',
];

const SPORTS: { value: Sport; label: string }[] = [
  { value: 'run', label: 'Run' },
  { value: 'ride', label: 'Ride' },
  { value: 'strength', label: 'Strength' },
  { value: 'walk', label: 'Walk' },
  { value: 'hike', label: 'Hike' },
  { value: 'functional', label: 'Functional' },
  { value: 'mobility', label: 'Mobility' },
];

const VISIBILITY: { value: Visibility; title: string; body: string }[] = [
  { value: 'private', title: 'Only me', body: 'Nothing is shared. You can still use everything.' },
  {
    value: 'followers',
    title: 'People I approve',
    body: 'Followers you accept can see your activities. Recommended.',
  },
  {
    value: 'public',
    title: 'Anyone',
    body: 'Your profile is discoverable. Activities still default to followers.',
  },
];

const STEPS = ['You', 'Experience', 'Goals', 'Sports', 'Privacy'] as const;

export function OnboardingFlow({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [displayName, setDisplayName] = useState(defaultName);
  const [experience, setExperience] = useState<'beginner' | 'intermediate' | 'advanced'>(
    'intermediate',
  );
  const [goals, setGoals] = useState<string[]>([]);
  const [sports, setSports] = useState<Sport[]>([]);
  const [weeklySessions, setWeeklySessions] = useState(3);
  const [visibility, setVisibility] = useState<Visibility>('followers');

  const canContinue = [
    displayName.trim().length > 0,
    true,
    goals.length > 0,
    sports.length > 0,
    true,
  ][step];

  const toggle = <T,>(list: T[], value: T, set: (v: T[]) => void) => {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await completeOnboarding({
        displayName: displayName.trim(),
        experience,
        goals,
        sports,
        weeklySessions,
        equipment: [],
        profileVisibility: visibility,
      });
      if (result.error) setError(result.error);
      else router.push('/home');
    });
  }

  return (
    <div className="mt-10">
      {/* Progress: a real ordered list, so it is announced as one. */}
      <ol className="mb-8 flex gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((name, i) => (
          <li
            key={name}
            aria-current={i === step ? 'step' : undefined}
            className={clsx('h-1 flex-1 rounded-pill', i <= step ? 'bg-signal' : 'bg-ink-700')}
          >
            <span className="sr-only">
              {name}
              {i < step ? ' (done)' : ''}
            </span>
          </li>
        ))}
      </ol>

      {error && (
        <p
          role="alert"
          className="mb-6 rounded-control border border-state-bad/40 bg-state-bad/10 px-4 py-3 text-secondary text-state-bad"
        >
          {error}
        </p>
      )}

      {step === 0 && (
        <Section
          title="What should we call you?"
          lead="This is the name people see if you share anything."
        >
          <Field
            label="Name"
            name="displayName"
            required
            placeholder="Alex Mercer"
            autoComplete="name"
            value={displayName}
            onChange={setDisplayName}
          />
        </Section>
      )}

      {step === 1 && (
        <Section
          title="Where are you in your training?"
          lead="This sets your starting volume. You can change it later."
        >
          <div className="space-y-3">
            {EXPERIENCE.map((option) => (
              <Choice
                key={option.value}
                selected={experience === option.value}
                onSelect={() => setExperience(option.value)}
                title={option.title}
                body={option.body}
              />
            ))}
          </div>
        </Section>
      )}

      {step === 2 && (
        <Section title="What are you working toward?" lead="Choose as many as apply.">
          <div className="flex flex-wrap gap-2.5">
            {GOALS.map((goal) => (
              <Chip
                key={goal}
                selected={goals.includes(goal)}
                onSelect={() => toggle(goals, goal, setGoals)}
              >
                {goal}
              </Chip>
            ))}
          </div>
        </Section>
      )}

      {step === 3 && (
        <Section
          title="What do you actually do?"
          lead="Pick everything you train. The first one becomes your primary sport."
        >
          <div className="flex flex-wrap gap-2.5">
            {SPORTS.map((sport) => (
              <Chip
                key={sport.value}
                selected={sports.includes(sport.value)}
                onSelect={() => toggle(sports, sport.value, setSports)}
              >
                {sport.label}
              </Chip>
            ))}
          </div>
          <div className="mt-8">
            <label htmlFor="weekly" className="mb-2 block text-secondary font-medium text-bone-200">
              Sessions a week
            </label>
            <input
              id="weekly"
              type="range"
              min={1}
              max={10}
              value={weeklySessions}
              onChange={(e) => setWeeklySessions(Number(e.target.value))}
              className="w-full accent-[#B8E62E]"
            />
            <p className="mt-2 text-secondary muted" aria-live="polite">
              {weeklySessions} {weeklySessions === 1 ? 'session' : 'sessions'} a week
            </p>
          </div>
        </Section>
      )}

      {step === 4 && (
        <Section
          title="Who can see your profile?"
          lead="Whatever you choose, your activities start followers-only and your routes start private."
        >
          <div className="space-y-3">
            {VISIBILITY.map((option) => (
              <Choice
                key={option.value}
                selected={visibility === option.value}
                onSelect={() => setVisibility(option.value)}
                title={option.title}
                body={option.body}
              />
            ))}
          </div>
        </Section>
      )}

      <div className="mt-10 flex gap-3">
        {step > 0 && (
          <Button
            variant="ghost"
            size="lg"
            onClick={() => setStep((s) => s - 1)}
            disabled={pending}
          >
            Back
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button
            size="lg"
            block={step === 0}
            onClick={() => setStep((s) => s + 1)}
            disabled={!canContinue}
          >
            Continue
          </Button>
        ) : (
          <Button size="lg" onClick={submit} disabled={pending}>
            {pending ? 'Setting up…' : 'Finish setup'}
          </Button>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h1 className="text-page-title font-display text-bone-100 text-balance">{title}</h1>
      <p className="mt-2.5 text-secondary muted">{lead}</p>
      <div className="mt-7">{children}</div>
    </section>
  );
}

function Choice({
  selected,
  onSelect,
  title,
  body,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={clsx(
        'w-full rounded-card border p-5 text-left transition-colors duration-200',
        selected ? 'border-signal bg-signal/10' : 'border-ink-600 bg-ink-800 hover:border-ink-600',
      )}
    >
      <p className="text-card-title text-bone-100">{title}</p>
      <p className="mt-1.5 text-secondary muted">{body}</p>
    </button>
  );
}

function Chip({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={clsx(
        'min-h-[44px] rounded-pill border px-4 text-secondary font-medium transition-colors duration-200',
        selected
          ? 'border-signal bg-signal text-ink-900'
          : 'border-ink-600 bg-ink-800 text-bone-200 hover:border-smoke-400',
      )}
    >
      {children}
    </button>
  );
}
