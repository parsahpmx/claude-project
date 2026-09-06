import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { OnboardingFlow } from '@/components/onboarding/flow';

export const metadata = { title: 'Set up your account' };
export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, onboarded_at')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.onboarded_at) redirect('/home');

  return (
    <div className="min-h-dvh bg-ink-900">
      <div className="mx-auto w-full max-w-xl px-6 py-14">
        <p className="font-display text-lg font-bold tracking-[0.14em] text-bone-100">FORGE</p>
        <OnboardingFlow defaultName={profile?.display_name ?? ''} />
      </div>
    </div>
  );
}
