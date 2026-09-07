'use client';

import { useActionState } from 'react';
import { signUp, type AuthState } from '@/app/(auth)/actions';
import { Button, ButtonLink } from '@/components/ui/primitives';
import { Field } from '@/components/ui/field';

export function SignUpForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(signUp, {});

  // The account was created but the project requires a confirmed email, so
  // there is no session to carry into onboarding. Say so here. Leaving the
  // form up would invite a second submission, which only trips the rate limit.
  if (state.notice) {
    return (
      <div className="space-y-5">
        <p
          role="status"
          className="rounded-control border border-signal/40 bg-signal/10 px-4 py-3 text-secondary text-bone-100"
        >
          {state.notice}
        </p>
        <p className="text-secondary muted">
          If it does not arrive, check your spam folder before requesting another.
        </p>
        <ButtonLink href="/login" block size="lg" variant="secondary">
          Go to sign in
        </ButtonLink>
      </div>
    );
  }

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
