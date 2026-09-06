'use client';

import { useActionState } from 'react';
import { signUp, type AuthState } from '@/app/(auth)/actions';
import { Button } from '@/components/ui/primitives';
import { Field } from '@/components/ui/field';

export function SignUpForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(signUp, {});

  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error && (
        <p
          role="alert"
          className="rounded-control border border-state-bad/40 bg-state-bad/10 px-4 py-3 text-secondary text-state-bad"
        >
          {state.error}
        </p>
      )}

      <Field
        label="Name"
        name="displayName"
        autoComplete="name"
        required
        hint="Shown to people you choose to share with."
      />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={state.fieldErrors?.email}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 8 characters."
        error={state.fieldErrors?.password}
      />

      <Button type="submit" block size="lg" disabled={pending}>
        {pending ? 'Creating your account…' : 'Create account'}
      </Button>

      <p className="text-caption muted">
        Your profile starts followers-only and your routes start private. You can change both at any
        time in Privacy.
      </p>
    </form>
  );
}
