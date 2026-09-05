import Link from 'next/link';
import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card, Chip, ButtonLink, Media } from '@/components/ui/primitives';
import { EmptyState, Status } from '@/components/ui/feedback';
import { CheckInForm } from '@/components/app/check-in-form';
import { apiFetch } from '@/lib/api';
import { formatDateLabel, formatRating, relativeTime, formatDateTime } from '@/lib/format';

export const metadata = { title: 'My coach' };

export const dynamic = 'force-dynamic';

interface CoachResponse {
  coach: {
    id: string; slug: string; headline: string; bio: string; philosophy: string;
    specialties: string[]; certifications: string[]; ratingTenths: number;
    imageKey: string; firstName: string; lastName: string; monthlyPriceCents: number;
  } | null;
  startedOn?: string;
  threadId?: string | null;
  unreadMessages?: number;
  nextBooking?: { id: string; kind: string; startsAt: string; durationMinutes: number; agenda: string | null } | null;
  checkIns?: {
    id: string; weekStart: string; score: number; band: string; flags: string[];
    energy: number; sleepQuality: number; stress: number;
    nutritionAdherence: number; trainingAdherence: number;
    coachResponse: string | null; respondedAt: string | null; painNotes: string | null;
    questions: string | null;
  }[];
  checkInDueThisWeek?: boolean;
  currentWeekStart?: string;
}

export default async function MemberCoachPage() {
  const data = await apiFetch<CoachResponse>('/v1/me/coach');

  if (!data.coach) {
    return (
      <AppSection>
        <PageHeader eyebrow="Coach" title="YOUR COACH" />
        <div className="mt-10">
          <EmptyState
            icon="◉"
            title="You do not have a coach yet"
            body="A FORGE coach reads your check-ins, reviews your form and rewrites the plan when your week changes. FORGE COACH includes one."
            action={<ButtonLink href="/coaching">Find My Coach</ButtonLink>}
          />
        </div>
      </AppSection>
    );
  }

  const coach = data.coach;
  const checkIns = data.checkIns ?? [];
  const latest = checkIns[0];

  return (
    <AppSection>
      <PageHeader
        eyebrow="Coaching"
        title="YOUR COACH"
        action={
          data.threadId ? (
            <ButtonLink href={`/app/messages?thread=${data.threadId}`}>
              Message {coach.firstName}
              {data.unreadMessages ? ` (${data.unreadMessages})` : ''}
            </ButtonLink>
          ) : null
        }
      />

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_1.6fr]">
        {/* --------------------------------------------------- coach card */}
        <div className="min-w-0 space-y-6">
          <Card>
            <Media imageKey={coach.imageKey} ratio="4/3" alt={`${coach.firstName} ${coach.lastName}`} />
            <div className="mt-5">
              <h2 className="display text-xl leading-none">{coach.firstName} {coach.lastName}</h2>
              <p className="mt-2 text-sm text-muted">{coach.headline}</p>
              <p className="mt-3 text-xs">
                <span aria-hidden className="text-accent">★</span> {formatRating(coach.ratingTenths)}
                {data.startedOn && <span className="text-muted"> · Coaching you since {formatDateLabel(data.startedOn)}</span>}
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {coach.specialties.map((s) => <Chip key={s} size="sm">{s.replace(/-/g, ' ')}</Chip>)}
              </div>
              <div className="mt-5">
                <Link href={`/coaching/${coach.slug}`} className="text-xs font-semibold uppercase tracking-[0.08em] text-accent">
                  Full profile →
                </Link>
              </div>
            </div>
          </Card>

          {data.nextBooking && (
            <Card tone="dark">
              <p className="eyebrow mb-3">Next session</p>
              <p className="font-semibold capitalize text-bone-100">{data.nextBooking.kind.replace(/-/g, ' ')}</p>
              <p className="mt-1 text-xs text-bone-200/55">
                {formatDateTime(data.nextBooking.startsAt)} ·{' '}
                {data.nextBooking.durationMinutes} min
              </p>
              {data.nextBooking.agenda && (
                <p className="mt-4 text-sm leading-relaxed text-bone-200/70">{data.nextBooking.agenda}</p>
              )}
              <div className="mt-5">
                <ButtonLink href="/app/calendar" variant="inverse" size="sm" block>Join Video Call</ButtonLink>
              </div>
            </Card>
          )}

          <Card>
            <p className="eyebrow mb-4">Certifications</p>
            <ul className="space-y-2 text-sm">
              {coach.certifications.map((certification) => (
                <li key={certification} className="flex gap-2.5">
                  <span aria-hidden className="text-accent">✓</span>
                  <span className="text-muted">{certification}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* ------------------------------------------------------ check-in */}
        <div className="min-w-0 space-y-6">
          {data.checkInDueThisWeek && data.currentWeekStart ? (
            <Card>
              <p className="eyebrow mb-2">Weekly check-in</p>
              <h2 className="display text-display-sm">HOW WAS YOUR WEEK?</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Nine questions. {coach.firstName} reads all nine and replies in writing — usually within a
                working day.
              </p>
              <div className="mt-8">
                <CheckInForm weekStart={data.currentWeekStart} />
              </div>
            </Card>
          ) : (
            latest && (
              <Card>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="eyebrow">This week&rsquo;s check-in</p>
                    <p className="display mt-2 text-display-sm">{latest.score}</p>
                    <p className="mt-1 text-sm capitalize text-muted">{latest.band.replace(/-/g, ' ')}</p>
                  </div>
                  <Status status={latest.respondedAt ? 'completed' : 'pending'} />
                </div>

                {latest.coachResponse ? (
                  <div className="accent-tint mt-6 rounded-card border border-ember/20 bg-ember/[0.05] p-5">
                    <p className="eyebrow mb-2 text-accent">{coach.firstName} replied</p>
                    <p className="text-sm leading-relaxed opacity-85">{latest.coachResponse}</p>
                    {latest.respondedAt && (
                      <p className="mt-3 text-xs text-muted">{relativeTime(latest.respondedAt)}</p>
                    )}
                  </div>
                ) : (
                  <p className="mt-6 text-sm text-muted">
                    Submitted — {coach.firstName} usually replies within a working day.
                  </p>
                )}
              </Card>
            )
          )}

          {checkIns.length > 0 && (
            <Card padded={false}>
              <div className="border-b border-ink-900/10 p-5">
                <p className="eyebrow">Check-in history</p>
              </div>
              <ul className="divide-y divide-ink-900/8">
                {checkIns.map((entry) => (
                  <li key={entry.id} className="p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-4">
                        <span
                          aria-hidden
                          className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-semibold ${bandTone(entry.band)}`}
                        >
                          {entry.score}
                        </span>
                        <div>
                          <p className="font-medium">Week of {formatDateLabel(entry.weekStart)}</p>
                          <p className="mt-0.5 text-xs capitalize text-muted">{entry.band.replace(/-/g, ' ')}</p>
                        </div>
                      </div>
                      {entry.flags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {entry.flags.map((flag) => (
                            <Chip key={flag} tone="warn" size="sm">{flag.replace(/-/g, ' ')}</Chip>
                          ))}
                        </div>
                      )}
                    </div>

                    <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                      <Score label="Energy" value={entry.energy} />
                      <Score label="Sleep" value={entry.sleepQuality} />
                      <Score label="Stress" value={entry.stress} inverted />
                      <Score label="Nutrition" value={entry.nutritionAdherence} />
                      <Score label="Training" value={entry.trainingAdherence} />
                    </dl>

                    {entry.painNotes && (
                      <p className="mt-4 rounded-[8px] border border-signal-warn/25 bg-signal-warn/[0.07] p-3 text-xs leading-relaxed">
                        <span className="font-semibold">Pain note:</span> {entry.painNotes}
                      </p>
                    )}

                    {entry.coachResponse && (
                      <p className="mt-4 border-l-2 border-ember pl-4 text-sm leading-relaxed opacity-80">
                        {entry.coachResponse}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </AppSection>
  );
}

function Score({ label, value, inverted }: { label: string; value: number; inverted?: boolean }) {
  const good = inverted ? value <= 2 : value >= 4;
  return (
    <div>
      <dt className="text-[0.625rem] uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className={`mt-1 text-sm font-semibold tabular-nums ${good ? 'text-status-good' : ''}`}>
        {value}<span className="font-normal text-muted">/5</span>
      </dd>
    </div>
  );
}

function bandTone(band: string): string {
  if (band === 'thriving') return 'bg-signal-good/15 text-status-good';
  if (band === 'on-track') return 'accent-tint bg-ember/12 text-chip-accent';
  if (band === 'strained') return 'bg-signal-warn/15 text-status-warn';
  return 'bg-signal-bad/12 text-status-bad';
}
