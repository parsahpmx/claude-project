'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives';
import { TextArea, TextInput } from '@/components/ui/forms';
import { ErrorState } from '@/components/ui/feedback';

/**
 * The weekly check-in.
 *
 * Five scales, a weight, a pain note and two free-text fields. The pain field
 * is deliberately its own question rather than a line in "anything else" —
 * asked directly, it gets answered, and it is the one answer that changes what
 * a coach does first.
 */

const SCALES = [
  { key: 'energy', label: 'Energy', low: 'Flat', high: 'Excellent' },
  { key: 'sleepQuality', label: 'Sleep quality', low: 'Poor', high: 'Excellent' },
  { key: 'stress', label: 'Stress', low: 'Calm', high: 'Overloaded' },
  { key: 'nutritionAdherence', label: 'Nutrition adherence', low: 'Off plan', high: 'On plan' },
  { key: 'trainingAdherence', label: 'Training adherence', low: 'Missed most', high: 'Hit everything' },
] as const;

export function CheckInForm({ weekStart }: { weekStart: string }) {
  const router = useRouter();
  const [scores, setScores] = useState<Record<string, number>>({
    energy: 3, sleepQuality: 3, stress: 3, nutritionAdherence: 3, trainingAdherence: 3,
  });
  const [state, setState] = useState<'idle' | 'pending' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState('pending');
    setError(null);

    const weightRaw = String(form.get('weightKg') ?? '').trim();
    const response = await fetch('/api/v1/me/coach/check-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        weekStart,
        ...scores,
        ...(weightRaw ? { weightKg: Number(weightRaw) } : {}),
        painNotes: String(form.get('painNotes') ?? '').trim() || undefined,
        questions: String(form.get('questions') ?? '').trim() || undefined,
        progressPhotoCount: 0,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: { message?: string } };
      setError(payload.error?.message ?? 'We could not submit your check-in.');
      setState('error');
      return;
    }
    setState('idle');
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-7">
      {error && <ErrorState title="Check-in not submitted" body={error} />}

      {SCALES.map((scale) => (
        <fieldset key={scale.key}>
          <legend className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] opacity-70">
            {scale.label}
          </legend>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={scores[scale.key] === value}
                onClick={() => setScores((current) => ({ ...current, [scale.key]: value }))}
                className={clsx(
                  'min-h-[48px] flex-1 rounded-[8px] border text-sm font-semibold tabular-nums transition-all duration-200',
                  scores[scale.key] === value
                    ? 'border-ember bg-ember text-bone-100'
                    : 'border-ink-900/15 hover:border-ink-900/40',
                )}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[0.625rem] opacity-45">
            <span>{scale.low}</span>
            <span>{scale.high}</span>
          </div>
        </fieldset>
      ))}

      <TextInput label="Weight (kg)" name="weightKg" type="number" step="0.1" min={20} max={400} hint="Optional." />
      <TextArea
        label="Pain or injury notes"
        name="painNotes"
        hint="Anything that hurt, however minor. Your coach reads this first."
      />
      <TextArea label="Questions for your coach" name="questions" hint="Optional." />

      <Button type="submit" size="lg" block disabled={state === 'pending'}>
        {state === 'pending' ? 'Submitting…' : 'Submit Check-In'}
      </Button>
    </form>
  );
}
