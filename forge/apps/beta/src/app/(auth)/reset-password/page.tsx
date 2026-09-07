import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Set a new password' };

// The recovery session comes from the emailed link, so this page is never the
// same twice and must not be cached.
export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage() {
  // Opening this page directly, or with an expired link, means no recovery
  // session. Checking here lets the form say so before anyone types anything.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  return (
    <>
      <h1 className="text-page-title font-display text-bone-100">Set a new password</h1>
      <p className="mt-2.5 text-secondary muted">
        Choose something you have not used elsewhere. You will stay signed in on this device.
      </p>
      <div className="mt-8">
        <ResetPasswordForm hasSession={Boolean(data.user)} />
      </div>
    </>
  );
}
