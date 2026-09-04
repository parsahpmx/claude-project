import Link from 'next/link';
import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card, Chip, ButtonLink } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/feedback';
import { apiFetch } from '@/lib/api';
import { formatCents, formatLongDate, formatTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface CoachCalendar {
  bookings: {
    booking: {
      id: string; kind: string; startsAt: string; durationMinutes: number;
      status: string; priceCents: number; agenda: string | null;
    };
    member: { id: string; firstName: string; lastName: string };
  }[];
}

export default async function CoachCalendarPage() {
  const { bookings } = await apiFetch<CoachCalendar>('/v1/coach/calendar');

  const byDay = new Map<string, typeof bookings>();
  for (const entry of bookings) {
    const day = entry.booking.startsAt.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), entry]);
  }

  return (
    <AppSection>
      <PageHeader
        eyebrow="Calendar"
        title="YOUR SESSIONS"
        lead="Consultations, coaching calls and form reviews. Times shown in UTC."
      />

      <div className="mt-10">
        {bookings.length === 0 ? (
          <EmptyState icon="▣" title="Nothing booked" body="Members book from your profile page." />
        ) : (
          <div className="space-y-8">
            {[...byDay.entries()].map(([day, entries]) => (
              <section key={day}>
                <h2 className="eyebrow mb-4">
                  {formatLongDate(day)}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {entries.map((entry) => (
                    <Card key={entry.booking.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="display text-lg leading-none tabular-nums">
                            {formatTime(entry.booking.startsAt)}
                          </p>
                          <p className="mt-2 font-medium">
                            {entry.member.firstName} {entry.member.lastName}
                          </p>
                        </div>
                        <Chip size="sm">{entry.booking.durationMinutes}m</Chip>
                      </div>

                      <p className="mt-3 text-xs capitalize opacity-55">
                        {entry.booking.kind.replace(/-/g, ' ')}
                        {entry.booking.priceCents > 0 && ` · ${formatCents(entry.booking.priceCents)}`}
                      </p>

                      {entry.booking.agenda && (
                        <p className="mt-3 text-sm leading-relaxed opacity-70">{entry.booking.agenda}</p>
                      )}

                      <div className="mt-5 flex flex-wrap gap-2">
                        <ButtonLink href={`/coach/clients/${entry.member.id}`} variant="ghost" size="sm">
                          Client profile
                        </ButtonLink>
                        <Link
                          href="/coach/calendar"
                          className="min-h-[40px] rounded-[6px] bg-ember px-4 text-[0.6875rem] font-semibold uppercase leading-[38px] tracking-[0.08em] text-bone-100"
                        >
                          Join Call
                        </Link>
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <section className="mt-12">
        <Card tone="dark">
          <p className="eyebrow mb-4">Live session view</p>
          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <div className="grain relative aspect-video overflow-hidden rounded-card bg-ink-800">
              <div className="absolute inset-0 grid place-items-center text-bone-200/40">
                <p className="text-sm">Coach video</p>
              </div>
              <div className="absolute bottom-4 right-4 aspect-video w-1/4 rounded-[8px] border border-bone-200/20 bg-ink-900/80">
                <div className="grid h-full place-items-center text-[0.625rem] text-bone-200/40">Client</div>
              </div>
              <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2 p-4">
                {['Mute', 'Camera', 'Share', 'End'].map((label) => (
                  <span
                    key={label}
                    className={`rounded-pill px-4 py-2 text-[0.6875rem] uppercase tracking-[0.1em] ${
                      label === 'End' ? 'bg-signal-bad text-bone-100' : 'bg-ink-900/80 text-bone-200/80'
                    }`}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <p className="eyebrow mb-2">Today&rsquo;s session</p>
                <p className="text-sm text-bone-200/75">
                  Review block one, retest the main lifts and set targets for the Build phase.
                </p>
              </div>
              <div>
                <p className="eyebrow mb-2">Exercise plan</p>
                <ul className="space-y-1.5 text-sm text-bone-200/70">
                  {['Back squat — retest 3RM', 'Bench press — technique review', 'Row — volume check'].map((item) => (
                    <li key={item} className="flex gap-2.5">
                      <span aria-hidden className="text-ember">·</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="eyebrow mb-2">Metrics</p>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-xs opacity-45">Adherence</dt><dd className="tabular-nums text-bone-100">92%</dd></div>
                  <div><dt className="text-xs opacity-45">Streak</dt><dd className="tabular-nums text-bone-100">18d</dd></div>
                </dl>
              </div>
            </div>
          </div>
          <p className="mt-5 text-xs text-bone-200/40">
            Video calling is not wired up in this prototype — the session layout, agenda and metric panel are.
          </p>
        </Card>
      </section>
    </AppSection>
  );
}
