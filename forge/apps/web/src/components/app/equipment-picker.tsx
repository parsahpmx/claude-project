'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { Button, Card } from '@/components/ui/primitives';
import { SuccessState, ErrorState } from '@/components/ui/feedback';

const EQUIPMENT = [
  { value: 'bodyweight', label: 'Bodyweight', note: 'Always available' },
  { value: 'dumbbells', label: 'Dumbbells', note: 'Adjustable or fixed pairs' },
  { value: 'barbell', label: 'Barbell', note: 'Olympic bar and plates' },
  { value: 'bench', label: 'Bench', note: 'Flat or adjustable' },
  { value: 'rack', label: 'Rack', note: 'Squat rack or cage with safeties' },
  { value: 'kettlebell', label: 'Kettlebell', note: 'One or more' },
  { value: 'resistance-bands', label: 'Resistance Bands', note: 'Loops or tubes' },
  { value: 'cable-machine', label: 'Cable Machine', note: 'Pulley or functional trainer' },
  { value: 'cardio-equipment', label: 'Cardio Equipment', note: 'Rower, bike or treadmill' },
  { value: 'full-gym', label: 'Full Gym', note: 'Implies everything above' },
];

export function EquipmentPicker({ owned }: { owned: string[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(owned);
  const [state, setState] = useState<'idle' | 'pending' | 'saved' | 'error'>('idle');

  const toggle = (value: string) => {
    setState('idle');
    setSelected((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    );
  };

  const save = async () => {
    setState('pending');
    const response = await fetch('/api/v1/me/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      // Bodyweight is always implied; sending it explicitly keeps the stored
      // list honest rather than relying on every reader to expand it.
      body: JSON.stringify({ equipment: [...new Set([...selected, 'bodyweight'])] }),
    });
    if (!response.ok) {
      setState('error');
      return;
    }
    setState('saved');
    router.refresh();
  };

  return (
    <Card>
      {state === 'saved' && (
        <div className="mb-6">
          <SuccessState
            title="Equipment updated"
            body="Every remaining session in your block has been re-checked against this setup."
          />
        </div>
      )}
      {state === 'error' && (
        <div className="mb-6">
          <ErrorState title="Could not save" body="Your selection has not been saved. Try again." />
        </div>
      )}

      <p className="eyebrow mb-5">What do you have access to?</p>

      <ul className="grid gap-3 sm:grid-cols-2">
        {EQUIPMENT.map((item) => {
          const active = selected.includes(item.value);
          const implied = !active && selected.includes('full-gym') && item.value !== 'full-gym';
          return (
            <li key={item.value}>
              <label
                className={clsx(
                  'flex cursor-pointer items-start gap-3 rounded-card border p-4 transition-all duration-200',
                  active
                    ? 'accent-tint border-ember bg-ember/[0.06]'
                    : implied
                      ? 'border-signal-good/25 bg-signal-good/[0.04]'
                      : 'border-ink-900/12 hover:border-ink-900/35',
                )}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => toggle(item.value)}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className={clsx(
                    'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-[4px] border text-[0.625rem]',
                    active
                      ? 'border-ember bg-ember-600 text-bone-100'
                      : implied
                        ? 'border-signal-good/40 text-status-good'
                        : 'border-ink-900/25',
                  )}
                >
                  {active ? '✓' : implied ? '✓' : ''}
                </span>
                <span>
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {implied ? 'Included by Full Gym' : item.note}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="mt-7">
        <Button size="lg" onClick={() => void save()} disabled={state === 'pending'}>
          {state === 'pending' ? 'Saving…' : 'Update Equipment'}
        </Button>
      </div>
    </Card>
  );
}
