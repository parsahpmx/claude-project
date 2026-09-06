'use client';

import { useState, useTransition } from 'react';
import clsx from 'clsx';
import type { Visibility } from '@forge/contracts';
import { updatePrivacy } from '@/app/(app)/settings/privacy/actions';
import { Card } from '@/components/ui/primitives';

interface Settings {
  profileVisibility: Visibility;
  defaultActivityVisibility: Visibility;
  routeVisibility: Visibility;
  requireFollowApproval: boolean;
  hideStartEnd: boolean;
  hideRadiusM: number;
  coachSharing: boolean;
  aggregateContribution: boolean;
  analyticsConsent: boolean;
  aiConsent: boolean;
}

const VISIBILITY_OPTIONS: { value: Visibility; label: string }[] = [
  { value: 'private', label: 'Only me' },
  { value: 'followers', label: 'Followers' },
  { value: 'public', label: 'Anyone' },
];

export function PrivacyForm({ settings, zoneCount }: { settings: Settings; zoneCount: number }) {
  const [state, setState] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function commit(patch: Partial<Settings>) {
    const next = { ...state, ...patch };
    setState(next);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updatePrivacy(patch);
      if (result.error) {
        setError(result.error);
        setState(state);            // put the control back where it was
      } else {
        setSaved(true);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* One live region for the whole form, so a screen reader hears the
          outcome of a toggle without the focus moving. */}
      <p aria-live="polite" className="sr-only">
        {pending ? 'Saving' : saved ? 'Saved' : ''}
      </p>

      {error && (
        <p role="alert" className="rounded-control border border-state-bad/40 bg-state-bad/10 px-4 py-3 text-secondary text-state-bad">
          {error}
        </p>
      )}

      <Card>
        <h2 className="text-section text-bone-100">Who can see what</h2>
        <div className="mt-5 space-y-6">
          <Choice
            legend="Your profile"
            hint="Controls whether people can find you and see your name and bio."
            value={state.profileVisibility}
            onChange={(v) => commit({ profileVisibility: v })}
          />
          <Choice
            legend="New activities"
            hint="The default for anything you record from now on. You can change any single activity afterwards."
            value={state.defaultActivityVisibility}
            onChange={(v) => commit({ defaultActivityVisibility: v })}
          />
          <Choice
            legend="Routes you build"
            hint="Routes often start at home, so this stays private unless you deliberately open it."
            value={state.routeVisibility}
            onChange={(v) => commit({ routeVisibility: v })}
          />
        </div>
      </Card>

      <Card>
        <h2 className="text-section text-bone-100">Your location</h2>
        <div className="mt-5 space-y-5">
          <Toggle
            label="Trim the start and end of activities"
            hint="Removes the beginning and end of every shared map. On by default, because a track that starts at your door is your address."
            checked={state.hideStartEnd}
            onChange={(v) => commit({ hideStartEnd: v })}
          />
          {state.hideStartEnd && (
            <div>
              <label htmlFor="radius" className="block text-secondary font-medium text-bone-200">
                How much to trim
              </label>
              <input
                id="radius" type="range" min={0} max={1000} step={50}
                value={state.hideRadiusM}
                onChange={(e) => setState({ ...state, hideRadiusM: Number(e.target.value) })}
                onMouseUp={() => commit({ hideRadiusM: state.hideRadiusM })}
                onTouchEnd={() => commit({ hideRadiusM: state.hideRadiusM })}
                className="mt-3 w-full accent-[#B8E62E]"
              />
              <p className="mt-2 text-secondary muted tabular-nums" aria-live="polite">
                {state.hideRadiusM} m from each end
              </p>
            </div>
          )}
          <p className="text-secondary muted">
            Private zones: <span className="text-bone-100">{zoneCount}</span>. Anything
            inside a zone is removed from shared maps wherever it falls in the activity,
            not just at the ends.
          </p>
        </div>
      </Card>

      <Card>
        <h2 className="text-section text-bone-100">Following</h2>
        <div className="mt-5">
          <Toggle
            label="Approve followers before they can see your activities"
            hint="On by default."
            checked={state.requireFollowApproval}
            onChange={(v) => commit({ requireFollowApproval: v })}
          />
        </div>
      </Card>

      <Card>
        <h2 className="text-section text-bone-100">Sharing beyond FORGE</h2>
        <p className="mt-2 text-secondary muted">
          Each of these is a separate decision. None of them is on unless you switch it on.
        </p>
        <div className="mt-5 space-y-5">
          <Toggle label="Share my training with a coach"
            hint="Lets a coach you are connected to see your activities and plan."
            checked={state.coachSharing} onChange={(v) => commit({ coachSharing: v })} />
          <Toggle label="Contribute to aggregated route popularity"
            hint="Not used yet. Turning it on now changes nothing until the feature ships."
            checked={state.aggregateContribution} onChange={(v) => commit({ aggregateContribution: v })} />
          <Toggle label="Product analytics"
            hint="Which screens get used. Never your location or your health data."
            checked={state.analyticsConsent} onChange={(v) => commit({ analyticsConsent: v })} />
          <Toggle label="Use my training to improve FORGE's suggestions"
            hint="Not used yet. Off by default."
            checked={state.aiConsent} onChange={(v) => commit({ aiConsent: v })} />
        </div>
      </Card>
    </div>
  );
}

function Choice({
  legend, hint, value, onChange,
}: { legend: string; hint: string; value: Visibility; onChange: (v: Visibility) => void }) {
  return (
    <fieldset>
      <legend className="text-secondary font-medium text-bone-200">{legend}</legend>
      <p className="mt-1 text-caption muted">{hint}</p>
      <div className="mt-3 flex gap-2">
        {VISIBILITY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={clsx(
              'min-h-[44px] flex-1 rounded-control border px-3 text-secondary font-medium transition-colors',
              value === option.value
                ? 'border-signal bg-signal text-ink-900'
                : 'border-ink-600 bg-ink-900 text-bone-200 hover:border-smoke-400',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Toggle({
  label, hint, checked, onChange,
}: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-5">
      <div className="min-w-0">
        <p className="text-secondary font-medium text-bone-200">{label}</p>
        <p className="mt-1 text-caption muted">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 h-7 w-12 shrink-0 rounded-pill border transition-colors duration-200',
          checked ? 'border-signal bg-signal' : 'border-ink-600 bg-ink-700',
        )}
      >
        <span
          aria-hidden
          className={clsx(
            'absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-pill transition-all duration-200 ease-forge',
            checked ? 'left-[26px] bg-ink-900' : 'left-[3px] bg-smoke-400',
          )}
        />
      </button>
    </div>
  );
}
