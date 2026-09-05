import clsx from 'clsx';
import type { ReactNode } from 'react';

/**
 * States: empty, loading, error, success.
 *
 * A screen without these three is a screen that has only ever been seen with
 * good data. Each is a first-class component so no page invents its own.
 */

export function EmptyState({
  title,
  body,
  action,
  icon = '—',
}: {
  title: string;
  body: string;
  action?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-ink-900/15 px-6 py-14 text-center">
      <span aria-hidden className="display mb-4 text-2xl opacity-25">{icon}</span>
      <h3 className="display text-lg">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-card border border-signal-bad/30 bg-signal-bad/[0.06] px-6 py-8"
    >
      <p className="eyebrow text-status-bad">Something went wrong</p>
      <h3 className="display mt-2 text-lg">{title}</h3>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SuccessState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-card border border-signal-good/30 bg-signal-good/[0.07] px-6 py-8">
      <p className="eyebrow text-status-good">Done</p>
      <h3 className="display mt-2 text-lg">{title}</h3>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Skeletons match the real content's box exactly, so nothing jumps on load. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={clsx('animate-pulse rounded-[8px] bg-ink-900/[0.07]', className)}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="light-surface rounded-card border border-ink-900/10 bg-bone-100 p-6">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="mt-5 h-3 w-24" />
      <Skeleton className="mt-3 h-6 w-3/4" />
      <Skeleton className="mt-3 h-3 w-full" />
    </div>
  );
}

/**
 * Status pill.
 *
 * Colour is never the only carrier: every status also shows a glyph and a
 * word, so it survives greyscale printing and colour-blindness alike.
 */
export function Status({
  status,
}: {
  status: 'completed' | 'scheduled' | 'skipped' | 'connected' | 'not-connected' | 'syncing' | 'pending' | 'paid';
}) {
  const map = {
    completed: { label: 'Completed', glyph: '✓', tone: 'text-status-good border-signal-good/30 bg-signal-good/10' },
    scheduled: { label: 'Scheduled', glyph: '○', tone: 'text-muted border-current/20 bg-current/[0.05]' },
    skipped: { label: 'Missed', glyph: '×', tone: 'text-status-bad border-signal-bad/30 bg-signal-bad/[0.08]' },
    connected: { label: 'Connected', glyph: '✓', tone: 'text-status-good border-signal-good/30 bg-signal-good/10' },
    'not-connected': { label: 'Not connected', glyph: '○', tone: 'text-muted border-current/20 bg-current/[0.05]' },
    syncing: { label: 'Syncing', glyph: '↻', tone: 'text-status-info border-signal-info/30 bg-signal-info/10' },
    pending: { label: 'Pending', glyph: '•', tone: 'text-status-warn border-signal-warn/30 bg-signal-warn/10' },
    paid: { label: 'Paid', glyph: '✓', tone: 'text-status-good border-signal-good/30 bg-signal-good/10' },
  } as const;
  const entry = map[status];
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.1em]',
        entry.tone,
      )}
    >
      <span aria-hidden>{entry.glyph}</span>
      {entry.label}
    </span>
  );
}

export function Badge({ children, earned = true }: { children: ReactNode; earned?: boolean }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-2 rounded-pill border px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.1em]',
        earned
          ? 'accent-tint border-ember/30 bg-ember/10 text-chip-accent'
          : 'border-current/20 bg-current/[0.04] text-muted',
      )}
    >
      <span aria-hidden>{earned ? '★' : '☆'}</span>
      {children}
    </span>
  );
}
