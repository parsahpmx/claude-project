import Link from 'next/link';
import { SignUpForm } from '@/components/auth/sign-up-form';

export const metadata = { title: 'Create your account' };

export default function SignupPage() {
  return (
    <>
      <h1 className="text-page-title font-display text-bone-100">Start your free beta</h1>
      <p className="mt-2.5 text-secondary muted">
        Ten questions, then a plan built around your answers.
      </p>
      <div className="mt-8">
        <SignUpForm />
      </div>
      <p className="mt-7 text-center text-secondary muted">
        Already training with us?{' '}
        <Link
          href="/login"
          className="font-semibold text-signal hover:underline underline-offset-4"
        >
          Log in
        </Link>
      </p>
    </>
  );
}
