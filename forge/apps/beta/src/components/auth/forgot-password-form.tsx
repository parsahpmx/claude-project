'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { requestPasswordReset, type AuthState } from '@/app/(auth)/actions';
import { Button, ButtonLink } from '@/components/ui/primitives';
import { Field } from '@/components/ui/field';

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(requestPasswordReset, {});

  // Once the request is accepted the form has nothing left to do, and leaving
  // it on screen invites people to submit again and trip the rate limit.
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
          The link is valid for a short time. If it does not arrive, check your spam folder before
          requesting another.
        </p>
        <ButtonLink href="/login" block size="lg" variant="secondary">
          Back to sign in
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
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={state.fieldErrors?.email}
      />

      <Button type="submit" block size="lg" disabled={pending}>
        {pending ? 'Sending…' : 'Send reset link'}
      </Button>

      <p className="text-center text-secondary muted">
        Remembered it?{' '}
        <Link
          href="/login"
          className="font-semibold text-signal hover:underline underline-offset-4"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
