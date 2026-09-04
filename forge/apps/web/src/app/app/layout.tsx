import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app/shell';
import { apiFetchOptional } from '@/lib/api';
import type { MemberProfile, SessionUser, Subscription } from '@/lib/types';

/**
 * Member application layout.
 *
 * The session is resolved here, once, and an unauthenticated visitor is
 * redirected before any child page runs a query. Every page below this layout
 * can assume a member.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await apiFetchOptional<{
    user: SessionUser;
    profile: MemberProfile | null;
    subscription: Subscription | null;
  }>('/v1/auth/me');

  if (!session) redirect('/signin');
  if (session.user.role === 'coach') redirect('/coach');

  const notifications = await apiFetchOptional<{ notifications: { readAt: string | null }[] }>(
    '/v1/me/notifications',
  );
  const unread = notifications?.notifications.filter((n) => n.readAt === null).length ?? 0;

  return (
    <AppShell
      role="member"
      user={session.user}
      unreadNotifications={unread}
      primaryAction={{ href: '/app/plan', label: 'Start Workout' }}
    >
      {children}
    </AppShell>
  );
}
