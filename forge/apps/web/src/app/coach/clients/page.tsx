import Link from 'next/link';
import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card, Chip } from '@/components/ui/primitives';
import { ProgressBar } from '@/components/ui/charts';
import { EmptyState } from '@/components/ui/feedback';
import { apiFetch } from '@/lib/api';
import { formatDateLabel } from '@/lib/format';

export const metadata = { title: 'Clients' };

export const dynamic = 'force-dynamic';

interface ClientRow {
  member: { id: string; firstName: string; lastName: string; email: string; avatarKey: string | null; lastSeenAt: string | null };
  profile: { primaryGoal: string; experience: string; daysPerWeek: number; equipment: string[] } | null;
  startedOn: string;
  week: { completed: number; scheduled: number; adherencePercent: number };
  latestCheckIn: { id: string; score: number; band: string; flags: string[]; respondedAt: string | null } | null;
  needsResponse: boolean;
}

export default async function CoachClientsPage() {
  const { clients } = await apiFetch<{ clients: ClientRow[] }>('/v1/coach/clients');

  return (
    <AppSection>
      <PageHeader
        eyebrow="Clients"
        title={`${clients.length} ACTIVE CLIENT${clients.length === 1 ? '' : 'S'}`}
        lead="Adherence this week, latest check-in and anything flagged — before you have to go looking for it."
      />

      <div className="mt-10">
        {clients.length === 0 ? (
          <EmptyState
            icon="◎"
            title="No active clients"
            body="Members who choose you from the marketplace appear here immediately."
          />
        ) : (
          <div className="grid gap-4">
            {clients.map((client) => (
              <Card key={client.member.id} padded={false}>
                <Link
                  href={`/coach/clients/${client.member.id}`}
                  className="block p-6 transition-colors hover:bg-ink-900/[0.02]"
                >
                  <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr_1fr] lg:items-center">
                    <div className="flex items-center gap-4">
                      <span
                        aria-hidden
                        className="dark-surface grid h-12 w-12 shrink-0 place-items-center rounded-full bg-ink-900 text-sm font-semibold text-bone-100"
                      >
                        {client.member.firstName.charAt(0)}{client.member.lastName.charAt(0)}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {client.member.firstName} {client.member.lastName}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {client.profile ? client.profile.primaryGoal.replace(/-/g, ' ') : 'No profile'} ·
                          client since {formatDateLabel(client.startedOn)}
                        </p>
                      </div>
                    </div>

                    <div>
                      <ProgressBar
                        value={client.week.completed}
                        max={Math.max(1, client.week.scheduled)}
                        label="This week"
                        valueLabel={`${client.week.completed}/${client.week.scheduled}`}
                        tone={client.week.adherencePercent >= 80 ? 'good' : client.week.adherencePercent >= 50 ? 'warn' : 'bad'}
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      {client.latestCheckIn ? (
                        <div className="flex items-center gap-3">
                          <span
                            aria-hidden
                            className={`grid h-10 w-10 place-items-center rounded-full text-xs font-semibold tabular-nums ${bandTone(client.latestCheckIn.band)}`}
                          >
                            {client.latestCheckIn.score}
                          </span>
                          <div>
                            <p className="text-xs capitalize text-muted">
                              {client.latestCheckIn.band.replace(/-/g, ' ')}
                            </p>
                            {client.needsResponse && (
                              <p className="text-[0.625rem] uppercase tracking-[0.1em] text-accent">
                                Awaiting reply
                              </p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted">No check-in yet</p>
                      )}

                      <div className="flex flex-wrap gap-1.5">
                        {client.latestCheckIn?.flags.map((flag) => (
                          <Chip key={flag} tone={flag === 'pain-reported' ? 'bad' : 'warn'} size="sm">
                            {flag.replace(/-/g, ' ')}
                          </Chip>
                        ))}
                      </div>
                    </div>
                  </div>
                </Link>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppSection>
  );
}

function bandTone(band: string): string {
  if (band === 'thriving') return 'bg-signal-good/15 text-status-good';
  if (band === 'on-track') return 'accent-tint bg-ember/12 text-chip-accent';
  if (band === 'strained') return 'bg-signal-warn/15 text-status-warn';
  return 'bg-signal-bad/12 text-status-bad';
}
