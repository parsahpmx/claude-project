'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';

/**
 * Per-session actions on the roadmap.
 *
 * Rescheduling, shortening and swapping all go through the same PATCH the
 * mobile app uses, so a session moved here is moved everywhere — including in
 * the coach's view of the same plan.
 */
export function PlanWeekActions({
  dayId,
  date,
  minutes,
}: {
  dayId: string;
  date: string;
  minutes: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (body: Record<string, unknown>) => {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/v1/me/plan/days/${dayId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setPending(false);
    if (!response.ok) {
      const payload = (await response.json()) as { error?: { message?: string } };
      setError(payload.error?.message ?? 'That did not work.');
      return;
    }
    setOpen(false);
    router.refresh();
  };

  const tomorrow = new Date(`${date}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const nextDay = tomorrow.toISOString().slice(0, 10);

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="min-h-[40px] rounded-[8px] border border-current/15 px-3 text-xs transition-colors hover:border-current/40"
      >
        <span className="sr-only">Adjust this session</span>
        <span aria-hidden>Adjust</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-2 w-60 rounded-card border border-ink-900/12 bg-bone-100 p-2 text-ink-900 shadow-lift"
        >
          {error && (
            <p role="alert" className="mb-2 px-3 py-2 text-xs text-signal-bad">{error}</p>
          )}
          {[
            { label: `Move to ${nextDay.slice(5)}`, body: { action: 'reschedule', date: nextDay } },
            { label: `Shorten to 30 minutes`, body: { action: 'shorten', minutes: 30 }, hide: minutes <= 30 },
            { label: 'Shorten to 20 minutes', body: { action: 'shorten', minutes: 20 } },
            { label: 'Skip this session', body: { action: 'skip' } },
          ]
            .filter((item) => !item.hide)
            .map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={pending}
                onClick={() => void act(item.body)}
                className={clsx(
                  'block w-full rounded-[6px] px-3 py-2.5 text-left text-sm transition-colors',
                  'hover:bg-ink-900/[0.05] disabled:opacity-50',
                )}
              >
                {item.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
