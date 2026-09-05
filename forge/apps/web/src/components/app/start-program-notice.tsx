'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card } from '@/components/ui/primitives';
import { ErrorState, SuccessState } from '@/components/ui/feedback';

/**
 * Starting a programme from inside the app.
 *
 * The confirmation is deliberate rather than a one-tap action: a member
 * halfway through a block should have to acknowledge that the current plan is
 * being archived before it happens.
 */
export function StartProgramNotice() {
  const router = useRouter();
  const [slug, setSlug] = useState('');
  const [state, setState] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const start = async () => {
    if (!slug.trim()) return;
    setState('pending');
    const response = await fetch('/api/v1/me/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ programSlug: slug.trim(), replaceExisting: true }),
    });
    if (!response.ok) {
      const body = (await response.json()) as { error?: { message?: string } };
      setMessage(body.error?.message ?? 'We could not start that programme.');
      setState('error');
      return;
    }
    setState('done');
    router.refresh();
  };

  if (state === 'done') {
    return (
      <SuccessState
        title="New plan built"
        body="Your full block is scheduled — every week, every session, every starting load. Open My Plan to see it."
      />
    );
  }

  return (
    <Card>
      {state === 'error' && (
        <div className="mb-5"><ErrorState title="Could not start programme" body={message} /></div>
      )}
      <p className="eyebrow mb-3">Start a programme</p>
      <p className="text-sm leading-relaxed text-muted">
        Paste a programme slug (for example <code className="font-mono">muscle-builder</code>) or open a
        programme below and start it from there.
      </p>
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <label htmlFor="program-slug" className="mb-2 block text-xs font-semibold uppercase tracking-[0.1em] opacity-70">
            Programme slug
          </label>
          <input
            id="program-slug"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder="muscle-builder"
            className="min-h-[48px] w-full rounded-[8px] border border-ink-900/15 px-4 text-sm focus:border-ember"
          />
        </div>
        <Button onClick={() => void start()} disabled={state === 'pending' || slug.trim().length === 0}>
          {state === 'pending' ? 'Building…' : 'Start Programme'}
        </Button>
      </div>
    </Card>
  );
}
