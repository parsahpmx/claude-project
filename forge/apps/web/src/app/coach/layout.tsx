import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app/shell';
import { apiFetchOptional } from '@/lib/api';
import type { SessionUser } from '@/lib/types';

export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const session = await apiFetchOptional<{ user: SessionUser }>('/v1/auth/me');
  if (!session) redirect('/signin');
  // A member landing here is sent to their own app rather than shown a 403 —
  // the URL is a mistake, not an attack, and the API enforces the boundary.
  if (session.user.role === 'member') redirect('/app');

  return (
    <AppShell role="coach" user={session.user}>
      {children}
    </AppShell>
  );
}
