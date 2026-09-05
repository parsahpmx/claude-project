'use client';

import { useState } from 'react';
import { Button, Card } from '@/components/ui/primitives';
import { TextInput, TextArea, FilterChips } from '@/components/ui/forms';
import { SuccessState, ErrorState } from '@/components/ui/feedback';

const SPECIALTIES = [
  { value: 'strength', label: 'Strength' },
  { value: 'hypertrophy', label: 'Hypertrophy' },
  { value: 'fat-loss', label: 'Fat Loss' },
  { value: 'endurance', label: 'Endurance' },
  { value: 'mobility', label: 'Mobility' },
  { value: 'nutrition', label: 'Nutrition' },
  { value: 'return-to-training', label: 'Return to Training' },
  { value: 'pre-post-natal', label: 'Pre & Post-Natal' },
  { value: 'sport-performance', label: 'Sport Performance' },
];

export function CoachApplication() {
  const [state, setState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextErrors: Record<string, string> = {};

    const fullName = String(form.get('fullName') ?? '').trim();
    const email = String(form.get('email') ?? '').trim();
    const certifications = String(form.get('certifications') ?? '').trim();
    const years = Number(form.get('yearsExperience'));
    const about = String(form.get('about') ?? '').trim();

    if (fullName.length < 2) nextErrors.fullName = 'Tell us your full name.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) nextErrors.email = 'That does not look like an email address.';
    if (certifications.length < 3) nextErrors.certifications = 'List at least one qualification.';
    if (!Number.isFinite(years) || years < 0) nextErrors.yearsExperience = 'Enter a number of years.';
    if (about.length < 40) nextErrors.about = 'A few sentences, please — members choose on how you think.';
    if (specialties.length === 0) nextErrors.specialties = 'Pick at least one specialism.';

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setState('submitting');
    try {
      const response = await fetch('/api/v1/coach-applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fullName, email, certifications, yearsExperience: years, about, specialties }),
      });
      setState(response.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  };

  if (state === 'done') {
    return (
      <SuccessState
        title="Application received"
        body="We review applications weekly and reply either way. If your qualifications check out we will send a consultation slot within five working days."
      />
    );
  }

  return (
    <Card>
      {state === 'error' && (
        <div className="mb-6">
          <ErrorState
            title="We could not submit that"
            body="Something went wrong on our side. Your answers are still here — try again in a moment."
          />
        </div>
      )}

      <form onSubmit={submit} noValidate className="space-y-6">
        <TextInput label="Full name" name="fullName" required error={errors.fullName} autoComplete="name" />
        <TextInput label="Email" name="email" type="email" required error={errors.email} autoComplete="email" />
        <TextInput
          label="Certifications"
          name="certifications"
          required
          error={errors.certifications}
          hint="Separate multiple qualifications with commas."
        />
        <TextInput
          label="Years coaching"
          name="yearsExperience"
          type="number"
          min={0}
          max={60}
          required
          error={errors.yearsExperience}
        />

        <div>
          <FilterChips
            label="Specialisms"
            options={SPECIALTIES}
            selected={specialties}
            onChange={setSpecialties}
            multi
          />
          {errors.specialties && (
            <p role="alert" className="mt-2 text-xs text-status-bad">
              <span aria-hidden>!</span> {errors.specialties}
            </p>
          )}
        </div>

        <TextArea
          label="Coaching philosophy"
          name="about"
          required
          error={errors.about}
          hint="How you think about programming, adherence and the clients you work best with."
        />

        <Button type="submit" size="lg" block disabled={state === 'submitting'}>
          {state === 'submitting' ? 'Submitting…' : 'Submit Application'}
        </Button>
        <p className="text-center text-xs text-muted">
          We reply to every application, including the ones we decline.
        </p>
      </form>
    </Card>
  );
}
