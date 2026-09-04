import Link from 'next/link';
import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card, Chip } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/feedback';
import { MessageThread } from '@/components/app/message-thread';
import { apiFetch } from '@/lib/api';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface CoachThreads {
  threads: {
    thread: { id: string; subject: string; lastMessageAt: string };
    member: { id: string; firstName: string; lastName: string; avatarKey: string | null };
    unread: number;
  }[];
}

interface ThreadDetail {
  thread: { id: string; subject: string };
  messages: {
    id: string; senderId: string; kind: string; body: string | null;
    mediaKey: string | null; durationSeconds: number | null; exerciseId: string | null;
    createdAt: string; readAt: string | null;
    formCheckComments: { id: string; timestampSeconds: number; body: string }[];
  }[];
}

export default async function CoachMessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [list, params, me] = await Promise.all([
    apiFetch<CoachThreads>('/v1/coach/messages'),
    searchParams,
    apiFetch<{ user: { id: string } }>('/v1/auth/me'),
  ]);

  if (list.threads.length === 0) {
    return (
      <AppSection>
        <PageHeader eyebrow="Messages" title="CLIENT MESSAGES" />
        <div className="mt-10">
          <EmptyState icon="✉" title="No conversations" body="A thread opens the moment a member chooses you." />
        </div>
      </AppSection>
    );
  }

  const requested = typeof params.thread === 'string' ? params.thread : null;
  const active = list.threads.find((t) => t.thread.id === requested) ?? list.threads[0]!;
  const detail = await apiFetch<ThreadDetail>(`/v1/me/messages/${active.thread.id}`);

  return (
    <AppSection>
      <PageHeader eyebrow="Messages" title="CLIENT MESSAGES" />

      <div className="mt-10 grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card padded={false}>
          <ul className="divide-y divide-ink-900/8">
            {list.threads.map((entry) => (
              <li key={entry.thread.id}>
                <Link
                  href={`/coach/messages?thread=${entry.thread.id}`}
                  className={`flex items-center gap-3 p-4 transition-colors hover:bg-ink-900/[0.02] ${
                    entry.thread.id === active.thread.id ? 'bg-ink-900/[0.04]' : ''
                  }`}
                >
                  <span
                    aria-hidden
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink-900 text-xs font-semibold text-bone-100"
                  >
                    {entry.member.firstName.charAt(0)}{entry.member.lastName.charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {entry.member.firstName} {entry.member.lastName}
                    </p>
                    <p className="truncate text-xs opacity-45">{relativeTime(entry.thread.lastMessageAt)}</p>
                  </div>
                  {entry.unread > 0 && <Chip tone="accent" size="sm">{entry.unread}</Chip>}
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <MessageThread
          threadId={active.thread.id}
          currentUserId={me.user.id}
          messages={detail.messages}
          coachName={active.member.firstName}
        />
      </div>
    </AppSection>
  );
}
