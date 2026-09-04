import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card, Chip, ButtonLink, Stat } from '@/components/ui/primitives';

import { Status, EmptyState } from '@/components/ui/feedback';
import { CoachNoteForm } from '@/components/app/coach-note-form';
import { CheckInResponse } from '@/components/app/check-in-response';
import { ApiRequestError, apiFetch } from '@/lib/api';
import { formatDateLabel, formatLoad, formatVolume, relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface ClientDetail {
  member: { id: string; firstName: string; lastName: string; email: string; timezone: string } | null;
  profile: {
    primaryGoal: string; experience: string; daysPerWeek: number; sessionMinutes: number;
    equipment: string[]; diet: string; heightCm: number | null; weightKg: number | null;
  } | null;
  plan: { programName: string; totalWeeks: number; startDate: string; goal: string } | null;
  summary: {
    totalWorkouts: number; trainingHours: number; totalVolumeGrams: number;
    currentStreakDays: number; weeklyAverage: number;
  };
  recentWorkouts: {
    id: string; title: string; date: string; durationSeconds: number;
    volumeGrams: number; averageRpe: number | null; kind: string;
  }[];
  personalRecords: { id: string; exerciseName: string; kind: string; valueGrams: number; achievedOn: string }[];
  workingLoads: { id: string; exerciseId: string; workingLoadGrams: number; bestLoadGrams: number }[];
  checkIns: {
    id: string; weekStart: string; score: number; band: string; flags: string[];
    energy: number; sleepQuality: number; stress: number;
    nutritionAdherence: number; trainingAdherence: number;
    painNotes: string | null; questions: string | null;
    coachResponse: string | null; respondedAt: string | null; submittedAt: string;
  }[];
  notes: { id: string; body: string; visibility: string; createdAt: string }[];
  threadId: string | null;
}

export default async function CoachClientPage({ params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;

  let data: ClientDetail;
  try {
    data = await apiFetch<ClientDetail>(`/v1/coach/clients/${memberId}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }

  if (!data.member) notFound();
  const { member, profile, plan, summary } = data;

  return (
    <AppSection>
      <Link href="/coach/clients" className="text-xs uppercase tracking-[0.14em] opacity-55 hover:opacity-100">
        ← All clients
      </Link>

      <div className="mt-6">
        <PageHeader
          eyebrow={plan ? `${plan.programName} · ${plan.totalWeeks} weeks` : 'No active plan'}
          title={`${member.firstName.toUpperCase()} ${member.lastName.toUpperCase()}`}
          lead={member.email}
          action={
            <div className="flex flex-wrap gap-2">
              {data.threadId && <ButtonLink href={`/coach/messages?thread=${data.threadId}`}>Message Client</ButtonLink>}
              <ButtonLink href="/coach/programs" variant="ghost">Edit Program</ButtonLink>
              <ButtonLink href="/coach/calendar" variant="ghost">Schedule Call</ButtonLink>
            </div>
          }
        />
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card><Stat label="Workouts" value={summary.totalWorkouts} hint={`${summary.weeklyAverage}/week`} /></Card>
        <Card><Stat label="Training hours" value={`${summary.trainingHours}h`} hint="Last 8 weeks" /></Card>
        <Card><Stat label="Total volume" value={formatVolume(summary.totalVolumeGrams)} hint="Load × reps" /></Card>
        <Card><Stat label="Streak" value={`${summary.currentStreakDays}d`} hint="Current" /></Card>
        <Card><Stat label="Records" value={data.personalRecords.length} hint="All time" /></Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          {/* -------------------------------------------------- check-ins */}
          <Card padded={false}>
            <div className="border-b border-ink-900/10 p-5">
              <p className="eyebrow">Check-ins</p>
            </div>
            {data.checkIns.length === 0 ? (
              <div className="p-6">
                <EmptyState icon="☑" title="No check-ins yet" body="They appear here every Monday." />
              </div>
            ) : (
              <ul className="divide-y divide-ink-900/8">
                {data.checkIns.map((entry) => (
                  <li key={entry.id} className="p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-4">
                        <span
                          aria-hidden
                          className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-semibold tabular-nums ${bandTone(entry.band)}`}
                        >
                          {entry.score}
                        </span>
                        <div>
                          <p className="font-medium">Week of {formatDateLabel(entry.weekStart)}</p>
                          <p className="mt-0.5 text-xs opacity-50">
                            {relativeTime(entry.submittedAt)} · {entry.band.replace(/-/g, ' ')}
                          </p>
                        </div>
                      </div>
                      <Status status={entry.respondedAt ? 'completed' : 'pending'} />
                    </div>

                    <dl className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
                      <Score label="Energy" value={entry.energy} />
                      <Score label="Sleep" value={entry.sleepQuality} />
                      <Score label="Stress" value={entry.stress} inverted />
                      <Score label="Nutrition" value={entry.nutritionAdherence} />
                      <Score label="Training" value={entry.trainingAdherence} />
                    </dl>

                    {entry.flags.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {entry.flags.map((flag) => (
                          <Chip key={flag} tone={flag === 'pain-reported' ? 'bad' : 'warn'} size="sm">
                            {flag.replace(/-/g, ' ')}
                          </Chip>
                        ))}
                      </div>
                    )}

                    {entry.painNotes && (
                      <p className="mt-4 rounded-[8px] border border-signal-bad/25 bg-signal-bad/[0.06] p-3 text-sm leading-relaxed">
                        <span className="font-semibold">Pain note:</span> {entry.painNotes}
                      </p>
                    )}
                    {entry.questions && (
                      <p className="mt-3 rounded-[8px] border border-ink-900/10 p-3 text-sm leading-relaxed">
                        <span className="font-semibold">Their question:</span> {entry.questions}
                      </p>
                    )}

                    {entry.coachResponse ? (
                      <p className="mt-4 border-l-2 border-ember pl-4 text-sm leading-relaxed opacity-80">
                        {entry.coachResponse}
                      </p>
                    ) : (
                      <div className="mt-5">
                        <CheckInResponse checkInId={entry.id} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* -------------------------------------------------- workouts */}
          <Card padded={false}>
            <div className="border-b border-ink-900/10 p-5">
              <p className="eyebrow">Recent training</p>
            </div>
            <ul className="divide-y divide-ink-900/8">
              {data.recentWorkouts.slice(0, 10).map((workout) => (
                <li key={workout.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div>
                    <p className="font-medium">{workout.title}</p>
                    <p className="mt-0.5 text-xs opacity-50">
                      {formatDateLabel(workout.date)} · {Math.round(workout.durationSeconds / 60)} min ·{' '}
                      {workout.kind}
                    </p>
                  </div>
                  <div className="flex items-center gap-5 text-sm tabular-nums">
                    <span className="opacity-70">{formatVolume(workout.volumeGrams)}</span>
                    {workout.averageRpe && (
                      <Chip size="sm" tone={workout.averageRpe >= 9 ? 'warn' : 'neutral'}>
                        RPE {workout.averageRpe}
                      </Chip>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <p className="eyebrow mb-5">Profile</p>
            {profile ? (
              <dl className="space-y-3 text-sm">
                <Row label="Goal" value={profile.primaryGoal.replace(/-/g, ' ')} />
                <Row label="Experience" value={profile.experience} />
                <Row label="Availability" value={`${profile.daysPerWeek} days · ${profile.sessionMinutes} min`} />
                <Row label="Diet" value={profile.diet.replace(/-/g, ' ')} />
                <Row label="Height" value={profile.heightCm ? `${profile.heightCm} cm` : '—'} />
                <Row label="Weight" value={profile.weightKg ? `${profile.weightKg} kg` : '—'} />
              </dl>
            ) : (
              <p className="text-sm opacity-60">No profile on file.</p>
            )}
            {profile && (
              <>
                <div className="rule my-5" />
                <p className="eyebrow mb-3">Equipment</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.equipment.map((item) => (
                    <Chip key={item} size="sm">{item.replace(/-/g, ' ')}</Chip>
                  ))}
                </div>
              </>
            )}
          </Card>

          <Card>
            <p className="eyebrow mb-5">Working loads</p>
            {data.workingLoads.length === 0 ? (
              <p className="text-sm opacity-60">No logged loads yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {data.workingLoads.slice(0, 10).map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate capitalize opacity-75">
                      {entry.exerciseId.replace(/-/g, ' ')}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {formatLoad(entry.workingLoadGrams)}
                      <span className="ml-2 text-xs opacity-45">best {formatLoad(entry.bestLoadGrams)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <p className="eyebrow mb-5">Coach notes</p>
            <p className="mb-4 text-xs leading-relaxed opacity-55">
              Private notes are never shown to the member. Shared notes appear in their Coach tab.
            </p>
            {data.notes.length > 0 && (
              <ul className="mb-5 space-y-3">
                {data.notes.map((note) => (
                  <li key={note.id} className="rounded-[8px] border border-ink-900/10 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <Chip size="sm" tone={note.visibility === 'shared' ? 'accent' : 'neutral'}>
                        {note.visibility}
                      </Chip>
                      <span className="text-xs opacity-40">{relativeTime(note.createdAt)}</span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed opacity-80">{note.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <CoachNoteForm memberId={member.id} />
          </Card>
        </div>
      </div>
    </AppSection>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="opacity-50">{label}</dt>
      <dd className="text-right capitalize">{value}</dd>
    </div>
  );
}

function Score({ label, value, inverted }: { label: string; value: number; inverted?: boolean }) {
  const good = inverted ? value <= 2 : value >= 4;
  const bad = inverted ? value >= 4 : value <= 2;
  return (
    <div>
      <dt className="text-[0.625rem] uppercase tracking-[0.12em] opacity-45">{label}</dt>
      <dd className={`mt-1 text-sm font-semibold tabular-nums ${good ? 'text-signal-good' : bad ? 'text-signal-warn' : ''}`}>
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
