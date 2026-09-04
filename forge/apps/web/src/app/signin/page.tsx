import Link from 'next/link';
import { SignInForm } from '@/components/marketing/sign-in-form';
import { generateImage } from '@/lib/imagery';

export const metadata = {
  title: 'Sign In',
  description: 'Sign in to your FORGE account.',
};

export default function SignInPage() {
  const backdrop = generateImage('signin-backdrop');

  return (
    <div className="dark-surface grid min-h-dvh bg-ink-900 text-bone-200 lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
        <Link href="/" className="display text-xl tracking-[0.08em] text-bone-100">FORGE</Link>

        <div className="mx-auto w-full max-w-sm py-16">
          <h1 className="display text-display-sm">WELCOME BACK.</h1>
          <p className="mt-3 text-sm text-bone-200/60">Pick up where your plan left off.</p>
          <div className="mt-10">
            <SignInForm />
          </div>
          <p className="mt-8 text-center text-sm text-bone-200/55">
            No account yet?{' '}
            <Link href="/assessment" className="text-bone-100 underline underline-offset-4">
              Take the assessment
            </Link>
          </p>
        </div>

        <p className="text-xs text-bone-200/35">© 2026 FORGE</p>
      </div>

      <div aria-hidden className="grain relative hidden lg:block" style={{ background: backdrop.background }}>
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900/80 to-transparent" />
        <div className="absolute inset-x-12 bottom-12">
          <p className="display text-display-md text-bone-100">YOUR PLAN.<br />YOUR COACH.<br />YOUR PROGRESS.</p>
        </div>
      </div>
    </div>
  );
}
