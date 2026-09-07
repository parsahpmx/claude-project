import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { TopNav, BottomNav } from '@/components/app/shell';

/**
 * Authenticated shell.
 *
 * The session is resolved once, here. Middleware already redirected anonymous
 * visitors, so reaching this layout without a user means the session expired
 * between the two — send them to log in rather than rendering a broken page.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
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

  // A half-finished account has nothing useful to show on Home.
  if (!profile?.onboarded_at) redirect('/onboarding');

  return (
    <div className="min-h-dvh bg-ink-900">
      <TopNav displayName={profile.display_name || 'Athlete'} />
      {/* Bottom padding clears the mobile nav; min-w-0 stops a wide child
          scrolling the document sideways. */}
      <main id="main" className="shell min-w-0 py-8 pb-28 md:pb-12">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
