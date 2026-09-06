import { useId } from 'react';
import clsx from 'clsx';

const CONTROL =
  'w-full min-h-[48px] rounded-control border bg-ink-800 px-4 text-body text-bone-100 ' +
  'placeholder:text-smoke-400 transition-colors duration-200 ' +
  'hover:border-ink-600 focus:border-signal';

/**
 * Every input is labelled, and every error is tied to its input with
 * aria-describedby — a screen reader user hears what went wrong on the field
 * it went wrong on, not as a disembodied sentence somewhere above the form.
 */
export function Field({
  label, name, type = 'text', required, hint, error, autoComplete, defaultValue, placeholder,
  value, onChange,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  autoComplete?: string;
  defaultValue?: string;
  placeholder?: string;
  /** Pass both to control the field; omit both to leave it uncontrolled. */
  value?: string;
  onChange?: (value: string) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-secondary font-medium text-bone-200">
        {label}
        {!required && <span className="ml-1.5 text-caption muted">optional</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        {...(onChange
          ? { value: value ?? '', onChange: (e) => onChange(e.target.value) }
          : { defaultValue })}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={clsx(CONTROL, error ? 'border-state-bad' : 'border-ink-600')}
      />
      {hint && <p id={hintId} className="mt-1.5 text-caption muted">{hint}</p>}
      {error && <p id={errorId} className="mt-1.5 text-caption text-state-bad">{error}</p>}
    </div>
  );
}
