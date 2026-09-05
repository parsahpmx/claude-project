'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/primitives';
import { TextInput } from '@/components/ui/forms';
import { ErrorState } from '@/components/ui/feedback';

/**
 * Sign in.
 *
 * The demo credentials are printed because this is a prototype and a reviewer
 * with no account cannot evaluate the product. In a real deployment this block
 * is the first thing to delete.
 */
const DEMO_ACCOUNTS = [
  { label: 'Member', email: 'alex@forge.fit' },
  { label: 'Coach', email: 'maya.roberts@forge.fit' },
];
const DEMO_PASSWORD = 'ForgeDemo!2026';

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? 'That email and password do not match.');
        setPending(false);
        return;
      }
      const body = (await response.json()) as { user: { role: string } };
      router.push(body.user.role === 'coach' ? '/coach' : '/app');
      router.refresh();
    } catch {
      setError('We could not reach the server. Check your connection and try again.');
      setPending(false);
    }
  };

  const fillDemoCredentials = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
  };

  return (
    <div className="space-y-6">
      {error && <ErrorState title="Sign in failed" body={error} />}

      <form onSubmit={submit} noValidate className="dark-surface space-y-5 [&_input]:border-bone-200/20 [&_input]:bg-ink-800 [&_input]:text-bone-100 [&_label]:text-bone-200/70">
        <TextInput
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextInput
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button type="submit" size="lg" block disabled={pending}>
          {pending ? 'Signing in…' : 'Sign In'}
        </Button>
      </form>

      <div className="dark-surface rounded-card border border-bone-200/12 bg-ink-800 p-5">
        <p className="eyebrow mb-3">Demo accounts</p>
        <div className="flex flex-wrap gap-2">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              onClick={() => fillDemoCredentials(account.email)}
              className="min-h-[40px] rounded-pill border border-bone-200/20 px-4 text-xs text-bone-200/80 transition-colors hover:border-bone-200/50 hover:text-bone-100"
            >
              {account.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[0.6875rem] text-muted">
          Password for both: <code className="font-mono">{DEMO_PASSWORD}</code>
        </p>
      </div>
    </div>
  );
}
