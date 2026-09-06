'use client';

import { useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn, type AuthState } from '@/app/(auth)/actions';
import { Button } from '@/components/ui/primitives';
import { Field } from '@/components/ui/field';

export function SignInForm() {
  const params = useSearchParams();
  const next = params.get('next');
  const [state, action, pending] = useActionState<AuthState, FormData>(signIn, {});

  return (
    <form action={action} className="space-y-5" noValidate>
      {next && <input type="hidden" name="next" value={next} />}

      {state.error && (
        <p role="alert" className="rounded-control border border-state-bad/40 bg-state-bad/10 px-4 py-3 text-secondary text-state-bad">
          {state.error}
        </p>
      )}

      <Field label="Email" name="email" type="email" autoComplete="email" required
        error={state.fieldErrors?.email} />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required
        error={state.fieldErrors?.password} />

      <Button type="submit" block size="lg" disabled={pending}>
        {pending ? 'Signing in…' : 'Log in'}
      </Button>
    </form>
  );
}
