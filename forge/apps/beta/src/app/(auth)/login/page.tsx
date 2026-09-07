import { Suspense } from 'react';
import Link from 'next/link';
import { SignInForm } from '@/components/auth/sign-in-form';
import { isSupabaseConfigured, toleratesMissingConfig } from '@/lib/supabase/config';

export const metadata = { title: 'Log in' };

export default function LoginPage() {
  // Someone running this for the first time has no .env.local, so signing in
  // cannot work. Say so here, where they are trying to do it, instead of
  // letting them type a password and meet a generic failure.
  const needsSetup = !isSupabaseConfigured() && toleratesMissingConfig();

  return (
    <>
      <h1 className="text-page-title font-display text-bone-100">Welcome back</h1>
      <p className="mt-2.5 text-secondary muted">Pick up where your training left off.</p>

      {needsSetup && (
        <div
          role="status"
          className="mt-6 rounded-control border border-signal/40 bg-signal/10 px-4 py-3 text-secondary"
        >
          <p className="font-semibold text-bone-100">Supabase is not configured yet</p>
          <p className="mt-1.5 muted">
            Copy <code className="text-bone-100">apps/beta/.env.example</code> to{' '}
            <code className="text-bone-100">apps/beta/.env.local</code> and add your project URL and
            publishable key, then restart the dev server. Both values are in the Supabase dashboard
            under Project Settings → API.
          </p>
        </div>
      )}

      <div className="mt-8">
        <Suspense fallback={null}>
          <SignInForm />
        </Suspense>
      </div>
      <p className="mt-7 text-center text-secondary muted">
        New to FORGE?{' '}
        <Link
          href="/signup"
          className="font-semibold text-signal hover:underline underline-offset-4"
        >
          Create an account
        </Link>
      </p>
    </>
  );
}
