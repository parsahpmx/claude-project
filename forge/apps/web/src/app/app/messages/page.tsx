import { AppSection, PageHeader } from '@/components/app/page-header';
import { MessageThread } from '@/components/app/message-thread';
import { EmptyState } from '@/components/ui/feedback';
import { ButtonLink } from '@/components/ui/primitives';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface ThreadList {
  threads: {
    thread: { id: string; subject: string; lastMessageAt: string };
    coach: { id: string; slug: string; headline: string; imageKey: string };
    coachUser: { firstName: string; lastName: string };
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

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [list, params, me] = await Promise.all([
    apiFetch<ThreadList>('/v1/me/messages'),
    searchParams,
    apiFetch<{ user: { id: string } }>('/v1/auth/me'),
  ]);

  if (list.threads.length === 0) {
    return (
      <AppSection>
        <PageHeader eyebrow="Messages" title="COACH MESSAGES" />
        <div className="mt-10">
          <EmptyState
            icon="✉"
            title="No conversations yet"
            body="Messaging opens when you have a coach. FORGE COACH includes direct messaging, voice notes and video form review."
            action={<ButtonLink href="/coaching">Find My Coach</ButtonLink>}
          />
        </div>
      </AppSection>
    );
  }

  const requested = typeof params.thread === 'string' ? params.thread : null;
  const active = list.threads.find((t) => t.thread.id === requested) ?? list.threads[0]!;
  const detail = await apiFetch<ThreadDetail>(`/v1/me/messages/${active.thread.id}`);

  return (
    <AppSection>
      <PageHeader
        eyebrow="Messages"
        title={`${active.coachUser.firstName.toUpperCase()} ${active.coachUser.lastName.toUpperCase()}`}
        lead={active.coach.headline}
      />
      <div className="mt-8">
        <MessageThread
          threadId={active.thread.id}
          currentUserId={me.user.id}
          messages={detail.messages}
          coachName={active.coachUser.firstName}
        />
      </div>
    </AppSection>
  );
}
