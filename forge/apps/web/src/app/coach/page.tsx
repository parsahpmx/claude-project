import Link from 'next/link';
import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card, Chip, ButtonLink, Stat } from '@/components/ui/primitives';
import { ProgressRing } from '@/components/ui/charts';
import { EmptyState } from '@/components/ui/feedback';
import { apiFetchOptional } from '@/lib/api';
import { formatCents, relativeTime, formatDateTime } from '@/lib/format';

export const metadata = { title: 'Coach overview' };

export const dynamic = 'force-dynamic';

interface Overview {
  coach: { slug: string; headline: string; clientCap: number; monthlyPriceCents: number; ratingTenths: number } | null;
  workload: { activeClients: number; pendingCheckIns: number; unreadMessages: number; upcomingCalls: number };
  capacity: { utilisation: number; status: 'available' | 'busy' | 'at-capacity'; message: string };
  upcomingCalls: {
    booking: { id: string; kind: string; startsAt: string; durationMinutes: number; agenda: string | null };
    member: { firstName: string; lastName: string };
  }[];
  needsAttention: {
    checkIn: { id: string; weekStart: string; score: number; band: string; flags: string[]; painNotes: string | null; submittedAt: string };
    member: { id: string; firstName: string; lastName: string; avatarKey: string | null };
  }[];
}

export default async function CoachOverviewPage() {
  // Next renders layout and page in parallel, so a member who lands here has
  // this query in flight while the layout is still redirecting them away.
  // Tolerating the 403 keeps that ordinary mistake out of the error log.
  const data = await apiFetchOptional<Overview>('/v1/coach/overview');
  if (!data) return null;

  return (
    <AppSection>
      <PageHeader
        eyebrow="Coach workspace"
        title="OVERVIEW"
        lead={data.coach?.headline}
        action={<ButtonLink href="/coach/check-ins">Open Check-ins</ButtonLink>}
      />

      <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card><Stat label="Active clients" value={data.workload.activeClients} hint={`Cap ${data.coach?.clientCap ?? 40}`} /></Card>
        <Card><Stat label="Pending check-ins" value={data.workload.pendingCheckIns} hint="Awaiting your reply" /></Card>
        <Card><Stat label="Unread messages" value={data.workload.unreadMessages} hint="Across all clients" /></Card>
        <Card><Stat label="Upcoming calls" value={data.workload.upcomingCalls} hint="Next 7 days" /></Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.6fr]">
        <Card tone="dark">
          <div className="flex items-center gap-7">
            <ProgressRing
              value={data.capacity.utilisation}
              size={112}
              sublabel="Capacity"
              tone={data.capacity.status === 'at-capacity' ? 'bad' : data.capacity.status === 'busy' ? 'warn' : 'good'}
            />
            <div>
              <p className="eyebrow">Roster</p>
              <p className="mt-2 text-lg font-semibold capitalize text-bone-100">
                {data.capacity.status.replace(/-/g, ' ')}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-bone-200/60">{data.capacity.message}</p>
            </div>
          </div>

          {data.coach && (
            <>
              <div className="rule my-6" />
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <p className="eyebrow">Monthly recurring</p>
                  <p className="display mt-2 text-2xl tabular-nums text-bone-100">
                    {formatCents(data.workload.activeClients * data.coach.monthlyPriceCents)}
                  </p>
                </div>
                <Link href="/coach/payments" className="text-xs font-semibold uppercase tracking-[0.08em] text-accent">
                  Payments →
                </Link>
              </div>
            </>
          )}
        </Card>

        <Card padded={false}>
          <div className="flex items-center justify-between gap-4 border-b border-ink-900/10 p-5">
            <p className="eyebrow">Needs attention</p>
            <Link href="/coach/check-ins" className="text-xs font-semibold uppercase tracking-[0.08em] text-accent">
              All check-ins →
            </Link>
          </div>

          {data.needsAttention.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon="✓"
                title="Nothing flagged"
                body="No client has reported pain, poor sleep or a missed week recently."
              />
            </div>
          ) : (
            <ul className="divide-y divide-ink-900/8">
              {data.needsAttention.map((entry) => (
                <li key={entry.checkIn.id}>
                  <Link
                    href={`/coach/clients/${entry.member.id}`}
                    className="block p-5 transition-colors hover:bg-ink-900/[0.02]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <span
                          aria-hidden
                          className="dark-surface grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink-900 text-xs font-semibold text-bone-100"
                        >
                          {entry.member.firstName.charAt(0)}{entry.member.lastName.charAt(0)}
                        </span>
                        <div>
                          <p className="font-medium">{entry.member.firstName} {entry.member.lastName}</p>
                          <p className="mt-0.5 text-xs text-muted">
                            Score {entry.checkIn.score} · {relativeTime(entry.checkIn.submittedAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {entry.checkIn.flags.map((flag) => (
                          <Chip
                            key={flag}
                            tone={flag === 'pain-reported' ? 'bad' : 'warn'}
                            size="sm"
                          >
                            {flag.replace(/-/g, ' ')}
                          </Chip>
                        ))}
                      </div>
                    </div>
                    {entry.checkIn.painNotes && (
                      <p className="mt-3 rounded-[8px] border border-signal-bad/25 bg-signal-bad/[0.06] p-3 text-xs leading-relaxed">
                        <span className="font-semibold">Pain note:</span> {entry.checkIn.painNotes}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {data.upcomingCalls.length > 0 && (
        <section className="mt-6">
          <Card padded={false}>
            <div className="border-b border-ink-900/10 p-5">
              <p className="eyebrow">Upcoming calls</p>
            </div>
            <ul className="divide-y divide-ink-900/8">
              {data.upcomingCalls.map((entry) => (
                <li key={entry.booking.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div>
                    <p className="font-medium">
                      {entry.member.firstName} {entry.member.lastName}
                    </p>
                    <p className="mt-0.5 text-xs capitalize text-muted">
                      {entry.booking.kind.replace(/-/g, ' ')} · {entry.booking.durationMinutes} min
                    </p>
                    {entry.booking.agenda && (
                      <p className="mt-2 max-w-prose text-xs text-muted">{entry.booking.agenda}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm tabular-nums">
                      {formatDateTime(entry.booking.startsAt)}
                    </p>
                    <Link href="/coach/calendar" className="mt-1 inline-block text-xs font-semibold uppercase tracking-[0.08em] text-accent">
                      Join call →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </AppSection>
  );
}
