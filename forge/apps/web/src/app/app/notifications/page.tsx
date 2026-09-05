import Link from 'next/link';
import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/feedback';
import { apiFetch } from '@/lib/api';
import { relativeTime } from '@/lib/format';

export const metadata = { title: 'Notifications' };

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const { notifications } = await apiFetch<{
    notifications: { id: string; kind: string; title: string; body: string; href: string | null; readAt: string | null; createdAt: string }[];
  }>('/v1/me/notifications');

  return (
    <AppSection>
      <PageHeader eyebrow="Notifications" title="WHAT'S NEW" />
      <div className="mt-10">
        {notifications.length === 0 ? (
          <EmptyState icon="◔" title="Nothing new" body="Plan updates, records and coach replies land here." />
        ) : (
          <Card padded={false}>
            <ul className="divide-y divide-ink-900/8">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <Link href={notification.href ?? '/app'} className="block p-5 transition-colors hover:bg-ink-900/[0.02]">
                    <div className="flex items-start gap-4">
                      <span
                        aria-hidden
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${notification.readAt ? 'bg-ink-900/15' : 'bg-ember'}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className={notification.readAt ? 'font-normal' : 'font-semibold'}>{notification.title}</p>
                        <p className="mt-1 text-sm text-muted">{notification.body}</p>
                        <p className="mt-2 text-xs text-muted">{relativeTime(notification.createdAt)}</p>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </AppSection>
  );
}
