'use client';

import { useActionState } from 'react';
import { updatePassword, type AuthState } from '@/app/(auth)/actions';
import { Button, ButtonLink } from '@/components/ui/primitives';
import { Field } from '@/components/ui/field';

/**
 * `hasSession` is resolved on the server before this renders. An expired or
 * already-used link has no recovery session, and telling someone that up front
 * is kinder than letting them type a new password twice and only then finding
 * out.
 */
export function ResetPasswordForm({ hasSession }: { hasSession: boolean }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(updatePassword, {});

  if (!hasSession) {
    return (
      <div className="space-y-5">
        <p
          role="alert"
          className="rounded-control border border-state-bad/40 bg-state-bad/10 px-4 py-3 text-secondary text-state-bad"
        >
          That reset link has expired or has already been used.
        </p>
        <p className="text-secondary muted">
          Reset links can be opened once, and only for a short time after they are sent.
        </p>
        <ButtonLink href="/forgot-password" block size="lg">
          Request a new link
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

      {/* autoComplete="new-password" is what tells a password manager to offer
          to generate and then save one, rather than autofilling the old one. */}
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        error={state.fieldErrors?.password}
        hint="At least 8 characters."
      />
      <Field
        label="Confirm new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        error={state.fieldErrors?.confirm}
      />

      <Button type="submit" block size="lg" disabled={pending}>
        {pending ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  );
}
