'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/primitives';
import { FilterChips, Select, TextInput } from '@/components/ui/forms';
import { SuccessState, ErrorState } from '@/components/ui/feedback';
import type { MemberProfile } from '@/lib/types';

const EQUIPMENT = [
  'bodyweight', 'dumbbells', 'barbell', 'bench', 'rack', 'kettlebell',
  'resistance-bands', 'cable-machine', 'full-gym', 'cardio-equipment',
];

const GOALS = [
  'build-muscle', 'lose-body-fat', 'improve-strength', 'improve-endurance',
  'build-healthy-habits', 'improve-mobility', 'train-for-competition',
];

const DIETS = ['balanced', 'high-protein', 'vegetarian', 'vegan', 'pescatarian', 'gluten-free', 'dairy-free'];

export function ProfileForm({
  user,
  profile,
}: {
  user: { firstName: string; lastName: string; unitSystem: string; timezone: string };
  profile: MemberProfile;
}) {
  const router = useRouter();
  const [equipment, setEquipment] = useState<string[]>(profile.equipment);
  const [state, setState] = useState<'idle' | 'pending' | 'saved' | 'error'>('idle');

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState('pending');

    const heightRaw = String(form.get('heightCm') ?? '').trim();
    const weightRaw = String(form.get('weightKg') ?? '').trim();

    const response = await fetch('/api/v1/me/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        firstName: String(form.get('firstName') ?? '').trim(),
        lastName: String(form.get('lastName') ?? '').trim(),
        unitSystem: String(form.get('unitSystem') ?? 'metric'),
        primaryGoal: String(form.get('primaryGoal') ?? profile.primaryGoal),
        diet: String(form.get('diet') ?? profile.diet),
        daysPerWeek: Number(form.get('daysPerWeek') ?? profile.daysPerWeek),
        sessionMinutes: Number(form.get('sessionMinutes') ?? profile.sessionMinutes),
        ...(heightRaw ? { heightCm: Number(heightRaw) } : {}),
        ...(weightRaw ? { weightKg: Number(weightRaw) } : {}),
        equipment,
      }),
    });

    if (!response.ok) {
      setState('error');
      return;
    }
    setState('saved');
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      {state === 'saved' && (
        <SuccessState
          title="Profile updated"
          body="Your plan re-checks every remaining session against these settings."
        />
      )}
      {state === 'error' && (
        <ErrorState title="Could not save" body="Something went wrong. Your changes have not been saved." />
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <TextInput label="First name" name="firstName" defaultValue={user.firstName} required />
        <TextInput label="Last name" name="lastName" defaultValue={user.lastName} required />
        <TextInput label="Height (cm)" name="heightCm" type="number" min={120} max={230} defaultValue={profile.heightCm ?? ''} />
        <TextInput label="Weight (kg)" name="weightKg" type="number" min={35} max={250} defaultValue={profile.weightKg ?? ''} />
        <Select
          label="Units"
          name="unitSystem"
          defaultValue={user.unitSystem}
          options={[
            { value: 'metric', label: 'Metric (kg, cm)' },
            { value: 'imperial', label: 'Imperial (lb, in)' },
          ]}
        />
        <Select
          label="Primary goal"
          name="primaryGoal"
          defaultValue={profile.primaryGoal}
          options={GOALS.map((g) => ({ value: g, label: titleCase(g) }))}
        />
        <Select
          label="Diet preference"
          name="diet"
          defaultValue={profile.diet}
          options={DIETS.map((d) => ({ value: d, label: titleCase(d) }))}
        />
        <Select
          label="Training days per week"
          name="daysPerWeek"
          defaultValue={String(profile.daysPerWeek)}
          options={[2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n} days` }))}
        />
        <Select
          label="Session length"
          name="sessionMinutes"
          defaultValue={String(profile.sessionMinutes)}
          options={[20, 30, 45, 60, 75].map((n) => ({ value: String(n), label: `${n} minutes` }))}
        />
      </div>

      <FilterChips
        label="My equipment"
        options={EQUIPMENT.map((e) => ({ value: e, label: titleCase(e) }))}
        selected={equipment}
        onChange={setEquipment}
        multi
      />

      <Button type="submit" size="lg" disabled={state === 'pending'}>
        {state === 'pending' ? 'Saving…' : 'Update Profile'}
      </Button>
    </form>
  );
}

function titleCase(value: string): string {
  return value.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
