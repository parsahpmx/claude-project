'use client';

import clsx from 'clsx';
import { formatNumber } from '@/lib/format';
import { useEffect, useId, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

/**
 * Form controls.
 *
 * Every control here renders a real `<label>` bound by id — not a placeholder
 * standing in for one. A placeholder disappears the moment somebody types,
 * which is exactly when a screen-reader user or anyone distracted needs it.
 */

export function Field({
  label,
  hint,
  error,
  required,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="block text-xs font-semibold uppercase tracking-[0.1em] opacity-70">
        {label}
        {required && <span aria-hidden className="ml-1 text-accent">*</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-status-bad">
          <span aria-hidden>!</span>
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL =
  'light-surface w-full min-h-[48px] rounded-[8px] border bg-bone-100 px-4 text-sm text-ink-900 ' +
  'placeholder:text-smoke-400 transition-colors duration-200 ' +
  'border-ink-900/15 hover:border-ink-900/30 focus:border-ember';

export function TextInput({
  label, hint, error, ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} required={rest.required} htmlFor={id}>
      <input
        id={id}
        {...rest}
        aria-invalid={error ? true : undefined}
        className={clsx(CONTROL, error && 'border-signal-bad')}
      />
    </Field>
  );
}

export function TextArea({
  label, hint, error, ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} required={rest.required} htmlFor={id}>
      <textarea
        id={id}
        rows={4}
        {...rest}
        aria-invalid={error ? true : undefined}
        className={clsx(CONTROL, 'min-h-[120px] resize-y py-3 leading-relaxed', error && 'border-signal-bad')}
      />
    </Field>
  );
}

export function Select({
  label, hint, error, options, ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string; hint?: string; error?: string;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} required={rest.required} htmlFor={id}>
      <select id={id} {...rest} className={clsx(CONTROL, 'appearance-none pr-10')}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </Field>
  );
}

/**
 * Large visual choice cards, used throughout onboarding.
 *
 * Implemented as real radio/checkbox inputs behind the card, so keyboard
 * navigation, form semantics and screen-reader grouping all work for free.
 */
export function ChoiceCard({
  name,
  value,
  label,
  description,
  checked,
  onChange,
  multi = false,
  tone = 'light',
}: {
  name: string;
  value: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: string) => void;
  multi?: boolean;
  /**
   * The ground this card sits on. Callers used to re-skin the label from
   * outside with `[&_label]:bg-ink-800`, which changed the colour but not the
   * surface marker — so the muted description kept its bone-ground value and
   * measured 2.8:1 on ink. A tone the component owns keeps the two in step.
   */
  tone?: 'light' | 'dark';
}) {
  const dark = tone === 'dark';
  return (
    <label
      className={clsx(
        'group relative flex cursor-pointer flex-col gap-1.5 rounded-card border p-5 transition-all duration-200 ease-forge',
        'hover:-translate-y-0.5 hover:shadow-card',
        checked && 'accent-tint border-ember bg-ember/[0.06] shadow-card',
        checked && dark && 'dark-surface',
        checked && !dark && 'light-surface',
        !checked && dark && 'dark-surface border-bone-200/15 bg-ink-800 text-bone-200 hover:border-bone-200/35',
        !checked && !dark && 'light-surface border-ink-900/12 bg-bone-100 hover:border-ink-900/30',
      )}
    >
      <input
        type={multi ? 'checkbox' : 'radio'}
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="sr-only"
      />
      <span className="flex items-start justify-between gap-3">
        <span className="font-semibold leading-snug">{label}</span>
        <span
          aria-hidden
          className={clsx(
            'mt-0.5 grid h-5 w-5 shrink-0 place-items-center border text-[0.625rem] transition-colors',
            multi ? 'rounded-[4px]' : 'rounded-full',
            checked ? 'border-ember bg-ember-600 text-bone-100' : 'border-ink-900/25',
          )}
        >
          {checked ? '✓' : ''}
        </span>
      </span>
      {description && <span className="text-xs leading-relaxed text-muted">{description}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  labels,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  labels: [string, string];
}) {
  return (
    <div
      role="group"
      aria-label={`${labels[0]} or ${labels[1]}`}
      className="light-surface inline-flex rounded-pill border border-ink-900/12 bg-bone-100 p-1"
    >
      {labels.map((label, index) => {
        const active = index === 1 ? checked : !checked;
        return (
          <button
            key={label}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(index === 1)}
            className={clsx(
              'min-h-[40px] rounded-pill px-5 text-xs font-semibold uppercase tracking-[0.1em] transition-all duration-200',
              active ? 'dark-surface bg-ink-900 text-bone-100 shadow-card' : 'text-muted hover:text-ink-900',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  description?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded-[4px] border-ink-900/25 text-accent accent-[#E8462B]"
      />
      <label htmlFor={id} className="cursor-pointer text-sm leading-relaxed">
        {label}
        {description && <span className="block text-xs text-muted">{description}</span>}
      </label>
    </div>
  );
}

export function FilterChips({
  label,
  options,
  selected,
  onChange,
  multi = false,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  multi?: boolean;
}) {
  const toggle = (value: string) => {
    if (!multi) {
      onChange(selected.includes(value) ? [] : [value]);
      return;
    }
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  return (
    <fieldset>
      <legend className="eyebrow mb-3">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(option.value)}
              className={clsx(
                'min-h-[40px] rounded-pill border px-4 text-xs font-medium transition-all duration-200 ease-forge',
                active
                  ? 'dark-surface border-ink-900 bg-ink-900 text-bone-100'
                  : 'light-surface border-ink-900/15 bg-bone-100 text-ink-700 hover:border-ink-900/40',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
}) {
  const id = useId();
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">{label}</label>
      <span aria-hidden className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 opacity-40">⌕</span>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="light-surface min-h-[56px] w-full rounded-pill border border-ink-900/15 bg-bone-100 pl-12 pr-5 text-base transition-colors hover:border-ink-900/30 focus:border-ember"
      />
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { value: string; label: string; count?: number }[];
  active: string;
  onChange: (value: string) => void;
}) {
  return (
    <div role="tablist" className="scroll-x scrollbar-none -mb-px flex gap-1 border-b border-current/10">
      {tabs.map((tab) => {
        const selected = tab.value === active;
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.value)}
            className={clsx(
              'relative min-h-[44px] whitespace-nowrap px-4 text-xs font-semibold uppercase tracking-[0.1em] transition-colors',
              selected ? 'text-ink-900' : 'text-muted hover:text-ink-700',
            )}
          >
            {tab.label}
            {typeof tab.count === 'number' && (
              <span className="ml-2 rounded-pill bg-current/10 px-1.5 py-0.5 text-[0.625rem] tabular-nums">{tab.count}</span>
            )}
            {selected && <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 bg-ember" />}
          </button>
        );
      })}
    </div>
  );
}

export function Counter({ target, suffix = '', duration = 900 }: { target: number; suffix?: string; duration?: number }) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    // Reduced motion gets the final number immediately rather than no number.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return undefined;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return <span className="tabular-nums">{formatNumber(value)}{suffix}</span>;
}
