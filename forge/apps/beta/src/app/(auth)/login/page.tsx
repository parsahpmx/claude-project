import { Suspense } from 'react';
import Link from 'next/link';
import { SignInForm } from '@/components/auth/sign-in-form';

export const metadata = { title: 'Log in' };

export default function LoginPage() {
  return (
    <>
      <h1 className="text-page-title font-display text-bone-100">Welcome back</h1>
      <p className="mt-2.5 text-secondary muted">Pick up where your training left off.</p>
      <div className="mt-8">
        <Suspense fallback={null}>
          <SignInForm />
        </Suspense>
      </div>
      <p className="mt-7 text-center text-secondary muted">
        New to FORGE?{' '}
        <Link href="/signup" className="font-semibold text-signal hover:underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </>
  );
}
