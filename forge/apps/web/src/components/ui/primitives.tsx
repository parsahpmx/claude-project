import Link from 'next/link';
import clsx from 'clsx';
import type { ComponentProps, ReactNode } from 'react';
import { generateImage, describeImage } from '@/lib/imagery';

/**
 * FORGE design system — primitives.
 *
 * Every one of these is a closed set of variants rather than a `className`
 * passthrough with defaults. Forty screens built from open-ended components
 * drift within a week; a closed variant list is what keeps the eleventh
 * screen looking like the first.
 */

// ---------------------------------------------------------------- Button

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'inverse' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 font-semibold uppercase tracking-[0.08em] ' +
  'transition-all duration-200 ease-forge select-none ' +
  'disabled:opacity-40 disabled:pointer-events-none ' +
  'active:translate-y-px';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-ember text-bone-100 hover:bg-ember-600 shadow-card hover:shadow-lift',
  secondary: 'bg-ink-900 text-bone-100 hover:bg-ink-700 shadow-card hover:shadow-lift',
  // `currentColor` rather than a fixed ink, so the same ghost button is legible
  // on the bone page ground and inside a dark card without a second variant.
  ghost:
    'bg-transparent text-current border border-current/25 hover:border-current/60 ' +
    'hover:bg-current/[0.06]',
  inverse: 'bg-bone-200 text-ink-900 hover:bg-bone-100 shadow-card',
  danger: 'bg-signal-bad text-bone-100 hover:brightness-95',
};

// 44px minimum height at every size — a touch target, not a mouse target.
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-[40px] px-4 text-[0.6875rem] rounded-[6px]',
  md: 'min-h-[48px] px-6 text-xs rounded-[8px]',
  lg: 'min-h-[56px] px-8 text-sm rounded-[10px]',
};

export interface ButtonProps extends Omit<ComponentProps<'button'>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  children: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', block, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={clsx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], block && 'w-full')}
    >
      {children}
    </button>
  );
}

export interface ButtonLinkProps {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  children: ReactNode;
  prefetch?: boolean;
}

export function ButtonLink({ href, variant = 'primary', size = 'md', block, children }: ButtonLinkProps) {
  return (
    <Link
      href={href}
      className={clsx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], block && 'w-full')}
    >
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------- Chip

export function Chip({
  children,
  tone = 'neutral',
  size = 'md',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'inverse';
  size?: 'sm' | 'md';
}) {
  const tones = {
    neutral: 'bg-ink-900/[0.05] text-ink-700 border-ink-900/10',
    accent: 'bg-ember/10 text-ember-600 border-ember/25',
    good: 'bg-signal-good/10 text-signal-good border-signal-good/25',
    warn: 'bg-signal-warn/12 text-signal-warn border-signal-warn/30',
    bad: 'bg-signal-bad/10 text-signal-bad border-signal-bad/25',
    inverse: 'bg-bone-200/10 text-bone-200 border-bone-200/20',
  } as const;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-pill border font-medium whitespace-nowrap',
        size === 'sm' ? 'px-2.5 py-1 text-[0.625rem]' : 'px-3 py-1.5 text-[0.6875rem]',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- Card

export function Card({
  children,
  interactive,
  tone = 'light',
  padded = true,
  id,
}: {
  children: ReactNode;
  interactive?: boolean;
  tone?: 'light' | 'dark' | 'bare';
  padded?: boolean;
  /** Present so a card can be an anchor target for in-page navigation. */
  id?: string;
}) {
  return (
    <div
      id={id}
      className={clsx(
        'relative rounded-card border transition-all duration-300 ease-forge',
        tone === 'dark' && 'dark-surface bg-ink-800 border-bone-200/10 text-bone-200',
        tone === 'light' && 'bg-bone-100 border-ink-900/10',
        tone === 'bare' && 'bg-transparent border-ink-900/10',
        padded && 'p-5 sm:p-6',
        interactive && 'hover:-translate-y-0.5 hover:shadow-lift',
      )}
    >
      {children}
    </div>
  );
}

export function CardLink({
  href,
  children,
  tone = 'light',
  padded = true,
}: {
  href: string;
  children: ReactNode;
  tone?: 'light' | 'dark' | 'bare';
  padded?: boolean;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        'group relative block rounded-card border transition-all duration-300 ease-forge',
        'hover:-translate-y-0.5 hover:shadow-lift',
        tone === 'dark' && 'dark-surface bg-ink-800 border-bone-200/10 text-bone-200',
        tone === 'light' && 'bg-bone-100 border-ink-900/10',
        tone === 'bare' && 'bg-transparent border-ink-900/10',
        padded && 'p-5 sm:p-6',
      )}
    >
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------- Media

export function Media({
  imageKey,
  alt,
  ratio = '4/3',
  rounded = true,
  overlay,
  variant = 'default',
  children,
}: {
  imageKey: string;
  alt?: string;
  ratio?: '1/1' | '4/3' | '3/2' | '16/9' | '21/9' | '3/4' | '2/3';
  rounded?: boolean;
  overlay?: boolean;
  variant?: 'default' | 'light';
  children?: ReactNode;
}) {
  const image = generateImage(imageKey, variant);
  return (
    <div
      role="img"
      aria-label={alt ?? describeImage(imageKey)}
      className={clsx(
        'grain relative overflow-hidden isolate',
        rounded && 'rounded-card',
      )}
      style={{ aspectRatio: ratio.replace('/', ' / '), background: image.background }}
    >
      {/* Hover zoom lives on a pseudo-layer so the content above stays crisp. */}
      <span
        aria-hidden
        className="absolute inset-0 -z-10 transition-transform duration-700 ease-forge group-hover:scale-[1.06]"
        style={{ background: image.background }}
      />
      {overlay && (
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-ink-900/85 via-ink-900/25 to-transparent"
        />
      )}
      {children && <div className="relative h-full w-full">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Layout

export function Section({
  children,
  tone = 'light',
  size = 'md',
  id,
}: {
  children: ReactNode;
  tone?: 'light' | 'dark' | 'bone';
  size?: 'sm' | 'md' | 'lg';
  id?: string;
}) {
  return (
    <section
      id={id}
      className={clsx(
        tone === 'dark' && 'dark-surface bg-ink-900 text-bone-200',
        tone === 'bone' && 'bg-bone-300/40',
        tone === 'light' && 'bg-bone-200',
        size === 'sm' && 'py-12 sm:py-16',
        size === 'md' && 'py-16 sm:py-24',
        size === 'lg' && 'py-20 sm:py-32',
      )}
    >
      <div className="shell">{children}</div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = 'left',
  action,
}: {
  eyebrow?: string;
  title: ReactNode;
  lead?: string;
  align?: 'left' | 'center';
  action?: ReactNode;
}) {
  return (
    <div
      className={clsx(
        'flex flex-col gap-5 md:flex-row md:items-end md:justify-between',
        align === 'center' && 'md:flex-col md:items-center md:text-center',
      )}
    >
      <div className={clsx('max-w-3xl', align === 'center' && 'mx-auto')}>
        {eyebrow && <p className="eyebrow mb-4">{eyebrow}</p>}
        <h2 className="display text-display-md text-balance">{title}</h2>
        {lead && <p className="mt-4 max-w-prose text-base leading-relaxed opacity-70">{lead}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'light',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'light' | 'dark';
}) {
  return (
    <div className={clsx(tone === 'dark' && 'dark-surface')}>
      <p className="eyebrow">{label}</p>
      <p className="display mt-2 text-display-sm tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs opacity-60">{hint}</p>}
    </div>
  );
}

export function Divider() {
  return <div className="rule my-8" />;
}
