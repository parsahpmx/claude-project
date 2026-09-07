'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { SPORTS, type Sport, type Visibility, DISTANCE_SPORTS } from '@forge/contracts';
import { Button, Card } from '@/components/ui/primitives';
import { Field } from '@/components/ui/field';
import { createActivity } from '@/app/(app)/activities/new/actions';
import { SPORT_LABEL } from '@/lib/format';

/**
 * Manual activity entry.
 *
 * The form changes shape with the sport: a strength session has no distance and
 * asking for one invites a zero that then pollutes every distance total. Only
 * fields that mean something for the chosen sport are shown.
 */
export function RecordActivityForm({ defaultVisibility }: { defaultVisibility: Visibility }) {
  const router = useRouter();
  const [sport, setSport] = useState<Sport>('run');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isDistance = DISTANCE_SPORTS.includes(sport);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createActivity(formData);
      if (result.error) setError(result.error);
      else if (result.id) router.push(`/activity/${result.id}`);
    });
  }

  return (
    <form action={onSubmit} className="space-y-6" noValidate>
      {error && (
        <p
          role="alert"
          className="rounded-control border border-state-bad/40 bg-state-bad/10 px-4 py-3 text-secondary text-state-bad"
        >
          {error}
        </p>
      )}

      <Card>
        <fieldset>
          <legend className="text-secondary font-medium text-bone-200">Sport</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {SPORTS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={sport === value}
                onClick={() => setSport(value)}
                className={clsx(
                  'min-h-[44px] rounded-pill border px-4 text-secondary font-medium transition-colors',
                  sport === value
                    ? 'border-signal bg-signal text-ink-900'
                    : 'border-ink-600 bg-ink-900 text-bone-200 hover:border-smoke-400',
                )}
              >
                {SPORT_LABEL[value]}
              </button>
            ))}
          </div>
          <input type="hidden" name="sport" value={sport} />
        </fieldset>
      </Card>

      <Card>
        <div className="space-y-5">
          <Field label="Title" name="title" required placeholder="Morning run" />
          <Field label="Date and time" name="startedAt" type="datetime-local" required />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Moving time (minutes)" name="movingMinutes" type="number" required />
            {isDistance && <Field label="Distance (km)" name="distanceKm" type="number" required />}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Climbing (m)" name="elevationGainM" type="number" />
            <Field
              label="Average heart rate"
              name="avgHr"
              type="number"
              hint="Leave blank if you did not wear a monitor."
            />
          </div>
          <Field label="Notes" name="description" hint="How it felt, what you changed." />
        </div>
      </Card>

      <Card>
        <fieldset>
          {/* A <legend> names the fieldset, not the control inside it, so the
              select was reaching screen readers with no accessible name at all.
              Pointing at the legend reuses the visible text rather than adding
              a second, hidden copy that could drift from it. */}
          <legend id="visibility-legend" className="text-secondary font-medium text-bone-200">
            Who can see this
          </legend>
          <p id="visibility-hint" className="mt-1 text-caption muted">
            Defaults to your privacy setting. You can change it later.
          </p>
          <select
            name="visibility"
            aria-labelledby="visibility-legend"
            aria-describedby="visibility-hint"
            defaultValue={defaultVisibility}
            className="mt-3 min-h-[48px] w-full rounded-control border border-ink-600 bg-ink-900 px-4 text-body text-bone-100"
          >
            <option value="private">Only me</option>
            <option value="followers">Followers</option>
            <option value="public">Anyone</option>
          </select>
        </fieldset>
      </Card>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Saving…' : 'Save activity'}
      </Button>
    </form>
  );
}
