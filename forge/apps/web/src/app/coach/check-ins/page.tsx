import Link from 'next/link';
import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card, Chip } from '@/components/ui/primitives';
import { EmptyState, Status } from '@/components/ui/feedback';
import { CheckInResponse } from '@/components/app/check-in-response';
import { apiFetch } from '@/lib/api';
import { formatDateLabel, relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface CheckInRow {
  checkIn: {
    id: string; weekStart: string; score: number; band: string; flags: string[];
    energy: number; sleepQuality: number; stress: number;
    nutritionAdherence: number; trainingAdherence: number;
    painNotes: string | null; questions: string | null;
    coachResponse: string | null; respondedAt: string | null; submittedAt: string;
  };
  member: { id: string; firstName: string; lastName: string; avatarKey: string | null };
  scoring: { overall: number; band: string; headline: string; coachPrompts: string[]; flags: string[] };
}

export default async function CoachCheckInsPage() {
  const { checkIns } = await apiFetch<{ checkIns: CheckInRow[] }>('/v1/coach/check-ins?status=pending');

  return (
    <AppSection>
      <PageHeader
        eyebrow="Check-ins"
        title={`${checkIns.length} AWAITING YOUR REPLY`}
        lead="Sorted so that anything flagged — pain, poor sleep, a missed week — is the first thing you read."
      />

      <div className="mt-10">
        {checkIns.length === 0 ? (
          <EmptyState
            icon="✓"
            title="All caught up"
            body="Every check-in has been answered. New ones arrive on Mondays."
          />
        ) : (
          <ul className="space-y-6">
            {checkIns.map((row) => (
              <li key={row.checkIn.id}>
                <Card padded={false}>
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-900/10 p-6">
                    <div className="flex items-center gap-4">
                      <span
                        aria-hidden
                        className={`grid h-12 w-12 shrink-0 place-items-center rounded-full text-sm font-semibold tabular-nums ${bandTone(row.checkIn.band)}`}
                      >
                        {row.checkIn.score}
                      </span>
                      <div>
                        <Link
                          href={`/coach/clients/${row.member.id}`}
                          className="font-semibold hover:underline"
                        >
                          {row.member.firstName} {row.member.lastName}
                        </Link>
                        <p className="mt-0.5 text-xs opacity-50">
                          Week of {formatDateLabel(row.checkIn.weekStart)} · {relativeTime(row.checkIn.submittedAt)}
                        </p>
                      </div>
                    </div>
                    <Status status="pending" />
                  </div>

                  <div className="grid gap-px bg-ink-900/8 lg:grid-cols-[1.3fr_1fr]">
                    <div className="bg-bone-100 p-6">
                      <p className="font-medium">{row.scoring.headline}</p>

                      <dl className="mt-5 grid grid-cols-3 gap-4 sm:grid-cols-5">
                        <Score label="Energy" value={row.checkIn.energy} />
                        <Score label="Sleep" value={row.checkIn.sleepQuality} />
                        <Score label="Stress" value={row.checkIn.stress} inverted />
                        <Score label="Nutrition" value={row.checkIn.nutritionAdherence} />
                        <Score label="Training" value={row.checkIn.trainingAdherence} />
                      </dl>

                      {row.checkIn.painNotes && (
                        <p className="mt-5 rounded-[8px] border border-signal-bad/25 bg-signal-bad/[0.06] p-4 text-sm leading-relaxed">
                          <span className="font-semibold">Pain note:</span> {row.checkIn.painNotes}
                        </p>
                      )}
                      {row.checkIn.questions && (
                        <p className="mt-3 rounded-[8px] border border-ink-900/10 p-4 text-sm leading-relaxed">
                          <span className="font-semibold">Their question:</span> {row.checkIn.questions}
                        </p>
                      )}

                      <div className="mt-6">
                        <CheckInResponse checkInId={row.checkIn.id} />
                      </div>
                    </div>

                    <div className="bg-bone-100 p-6">
                      <p className="eyebrow mb-4">Open with</p>
                      {row.scoring.coachPrompts.length === 0 ? (
                        <p className="text-sm opacity-60">
                          Nothing flagged. A short acknowledgement and one thing to focus on is enough.
                        </p>
                      ) : (
                        <ol className="space-y-3">
                          {row.scoring.coachPrompts.map((prompt, index) => (
                            <li key={prompt} className="flex gap-3 text-sm">
                              <span aria-hidden className="shrink-0 tabular-nums text-ember">
                                {index + 1}.
                              </span>
                              <span className="opacity-80">{prompt}</span>
                            </li>
                          ))}
                        </ol>
                      )}

                      {row.scoring.flags.length > 0 && (
                        <div className="mt-5 flex flex-wrap gap-1.5">
                          {row.scoring.flags.map((flag) => (
                            <Chip key={flag} tone={flag === 'pain-reported' ? 'bad' : 'warn'} size="sm">
                              {flag.replace(/-/g, ' ')}
                            </Chip>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppSection>
  );
}

function Score({ label, value, inverted }: { label: string; value: number; inverted?: boolean }) {
  const bad = inverted ? value >= 4 : value <= 2;
  return (
    <div>
      <dt className="text-[0.625rem] uppercase tracking-[0.12em] opacity-45">{label}</dt>
      <dd className={`mt-1 text-sm font-semibold tabular-nums ${bad ? 'text-signal-warn' : ''}`}>
        {value}<span className="font-normal opacity-40">/5</span>
      </dd>
    </div>
  );
}

function bandTone(band: string): string {
  if (band === 'thriving') return 'bg-signal-good/15 text-signal-good';
  if (band === 'on-track') return 'bg-ember/12 text-ember-600';
  if (band === 'strained') return 'bg-signal-warn/15 text-signal-warn';
  return 'bg-signal-bad/12 text-signal-bad';
}
