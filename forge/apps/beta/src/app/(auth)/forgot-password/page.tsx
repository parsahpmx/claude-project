import Link from 'next/link';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export const metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-page-title font-display text-bone-100">Reset your password</h1>
      <p className="mt-2.5 text-secondary muted">
        Enter the email you signed up with and we will send you a link to set a new password.
      </p>
      <div className="mt-8">
        <ForgotPasswordForm />
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
