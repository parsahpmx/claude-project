import Link from 'next/link';
import clsx from 'clsx';
import type { ComponentProps, ReactNode } from 'react';

/**
 * FORGE Web primitives. Closed variant sets rather than className passthrough:
 * forty screens built from open-ended components drift within a week.
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 font-semibold tracking-[0.04em] ' +
  'transition-all duration-200 ease-forge select-none rounded-control ' +
  'disabled:opacity-45 disabled:pointer-events-none active:translate-y-px';

const VARIANTS: Record<Variant, string> = {
  // Ink text on lime: 13.5:1. The accent is a surface here, not a tint.
  primary: 'bg-signal text-ink-900 hover:bg-signal-400 shadow-card',
  secondary: 'bg-ink-700 text-bone-100 hover:bg-ink-600 border border-ink-600',
  ghost: 'bg-transparent text-current border border-current/25 hover:border-current/50 hover:bg-current/[0.06]',
  danger: 'bg-state-bad text-ink-900 hover:brightness-110',
};

// 44px minimum at every size: a touch target, not a mouse target.
const SIZES: Record<Size, string> = {
  sm: 'min-h-[40px] px-4 text-caption',
  md: 'min-h-[44px] px-5 text-button',
  lg: 'min-h-[52px] px-7 text-button',
};

export interface ButtonProps extends Omit<ComponentProps<'button'>, 'className'> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  children: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', block, children, ...rest }: ButtonProps) {
  return (
    <button {...rest} className={clsx(BASE, VARIANTS[variant], SIZES[size], block && 'w-full')}>
      {children}
    </button>
  );
}

export function ButtonLink({
  href, variant = 'primary', size = 'md', block, children,
}: { href: string; variant?: Variant; size?: Size; block?: boolean; children: ReactNode }) {
  return (
    <Link href={href} className={clsx(BASE, VARIANTS[variant], SIZES[size], block && 'w-full')}>
      {children}
    </Link>
  );
}

export function Card({
  children, as: As = 'div', interactive, padded = true, className,
}: {
  children: ReactNode;
  as?: 'div' | 'article' | 'section' | 'li';
  interactive?: boolean;
  padded?: boolean;
  className?: string;
}) {
  return (
    <As className={clsx('card', padded && 'p-5', interactive && 'transition-transform duration-200 ease-forge hover:-translate-y-0.5 hover:shadow-lift', className)}>
      {children}
    </As>
  );
}

/**
 * A metric. Value first, label under it — on a training screen the number is
 * what you came for, and the label is only there to say what it is.
 */
export function Metric({
  label, value, unit, size = 'l', hint,
}: { label: string; value: ReactNode; unit?: string; size?: 'l' | 'xl'; hint?: string }) {
  return (
    <div>
      <p className={clsx('tabular-nums text-bone-100', size === 'xl' ? 'text-metric-xl' : 'text-metric-l')}>
        {value}
        {unit && <span className="ml-1 text-secondary font-normal muted">{unit}</span>}
      </p>
      <p className="eyebrow mt-1.5">{label}</p>
      {hint && <p className="mt-1 text-secondary muted">{hint}</p>}
    </div>
  );
}

export function Badge({
  children, tone = 'neutral',
}: { children: ReactNode; tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'bad' }) {
  const tones = {
    neutral: 'border-ink-600 bg-ink-700 text-bone-200',
    accent: 'border-signal/40 bg-signal/12 text-signal',
    good: 'border-state-good/40 bg-state-good/10 text-state-good',
    warn: 'border-state-warn/40 bg-state-warn/10 text-state-warn',
    bad: 'border-state-bad/40 bg-state-bad/10 text-state-bad',
  } as const;
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-caption font-semibold whitespace-nowrap', tones[tone])}>
      {children}
    </span>
  );
}

export function EmptyState({
  title, body, action,
}: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-ink-600 px-6 py-12 text-center">
      <h3 className="text-section text-bone-100">{title}</h3>
      <p className="mt-2 max-w-sm text-secondary muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div role="alert" className="rounded-card border border-state-bad/30 bg-state-bad/[0.06] px-6 py-7">
      <p className="eyebrow text-state-bad">Something went wrong</p>
      <h3 className="mt-2 text-section text-bone-100">{title}</h3>
      <p className="mt-2 max-w-prose text-secondary muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx('animate-pulse rounded-control bg-ink-700', className)} />;
}
