import Link from 'next/link';
import { AppSection } from '@/components/app/page-header';
import { Card, Chip, ButtonLink } from '@/components/ui/primitives';
import { ProgressRing, ProgressBar } from '@/components/ui/charts';
import { Status, EmptyState } from '@/components/ui/feedback';
import { apiFetch } from '@/lib/api';
import { formatMinutes, formatSleep, formatNumber } from '@/lib/format';
import type { PlanDay, Readiness } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface Dashboard {
  greeting: string;
  dateLabel: string;
  date: string;
  member: { firstName: string; unitSystem: string };
  readiness: Readiness;
  recoveryScore: number;
  today: PlanDay | null;
  plan: { programName: string; totalWeeks: number; startDate: string; goal: string } | null;
  week: { start: string; completed: number; scheduled: number; adherencePercent: number; days: PlanDay[] };
  streak: { current: number; longest: number };
  load: { zone: string; message: string; ratio: number };
  metrics: {
    steps: number | null; stepsTarget: number; sleepMinutes: number | null;
    waterMl: number | null; waterTargetMl: number;
  };
  nutrition: {
    targets: { calories: number; proteinGrams: number; carbGrams: number; fatGrams: number; waterMl: number };
    consumedCalories: number;
    consumedProtein: number;
  } | null;
  timeline: { time: string; label: string; kind: string }[];
  nextEvent: { title: string; date: string; kind: string; startMinutes: number } | null;
  unreadNotifications: number;
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default async function DashboardPage() {
  const data = await apiFetch<Dashboard>('/v1/me/dashboard');
  const today = data.today;
  const isTrainingDay = today !== null && today.kind !== 'rest';

  return (
    <AppSection>
      {/* ---------------------------------------------------------- header */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="eyebrow mb-3">{data.dateLabel}</p>
          <h1 className="display text-display-md text-balance">
            {data.greeting}, {data.member.firstName}.
          </h1>
          {data.plan && (
            <p className="mt-3 text-sm opacity-65">
              {data.plan.programName} · Week {weekNumber(data.plan.startDate, data.date)} of{' '}
              {data.plan.totalWeeks}
            </p>
          )}
        </div>

        <Card>
          <div className="flex items-center gap-6">
            <ProgressRing
              value={data.readiness.score ?? 0}
              label="Readiness"
              sublabel={data.readiness.band === 'unknown' ? 'No data' : data.readiness.headline}
              tone={readinessTone(data.readiness.band)}
            />
            <div className="max-w-[220px]">
              <p className="text-sm font-semibold">{data.readiness.headline}</p>
              <p className="mt-1.5 text-xs leading-relaxed opacity-65">{data.readiness.guidance}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* ---------------------------------------------------------- today */}
      <div className="mt-10 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0 space-y-6">
          {isTrainingDay ? (
            <Card tone="dark" padded={false}>
              <div className="p-6 sm:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="eyebrow">Today&rsquo;s training</p>
                    <h2 className="display mt-3 text-display-sm text-bone-100">{today.title}</h2>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Chip tone="inverse" size="sm">{formatMinutes(today.minutes)}</Chip>
                      <Chip tone="inverse" size="sm">{today.focus}</Chip>
                      <Chip tone="inverse" size="sm">{today.kind}</Chip>
                    </div>
                  </div>
                  <Status status={today.status} />
                </div>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  {today.status === 'completed' ? (
                    <ButtonLink href="/app/progress" variant="inverse" size="lg">See Your Numbers</ButtonLink>
                  ) : (
                    <>
                      <ButtonLink href={`/workout/${today.id}`} size="lg">Start Workout</ButtonLink>
                      <ButtonLink href="/app/plan" variant="inverse" size="lg">Adjust Session</ButtonLink>
                    </>
                  )}
                </div>
              </div>

              <div className="border-t border-bone-200/10 p-6 sm:px-8">
                <p className="eyebrow mb-5">Your day</p>
                <ol className="scroll-x scrollbar-none flex gap-4 pb-1">
                  {data.timeline.map((entry) => (
                    <li key={`${entry.time}-${entry.label}`} className="min-w-[124px] flex-1">
                      <div className="relative">
                        <div className="h-px w-full bg-bone-200/15" />
                        <span
                          aria-hidden
                          className={`absolute -top-1 left-0 h-2 w-2 rounded-full ${
                            entry.kind === 'training' ? 'bg-ember' : 'bg-bone-200/30'
                          }`}
                        />
                      </div>
                      <p className="mt-3 text-xs font-semibold tabular-nums text-bone-100">{entry.time}</p>
                      <p className="mt-1 text-xs text-bone-200/55">{entry.label}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </Card>
          ) : (
            <Card tone="dark">
              <p className="eyebrow">Today</p>
              <h2 className="display mt-3 text-display-sm text-bone-100">REST DAY</h2>
              <p className="mt-3 max-w-prose text-sm leading-relaxed text-bone-200/65">
                Nothing is scheduled, and that is deliberate — the adaptation from this week happens on days
                like today. A fifteen-minute mobility session or an easy walk fits without touching recovery.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <ButtonLink href="/app/recovery" size="lg">Open Recovery</ButtonLink>
                <ButtonLink href="/app/plan" variant="inverse" size="lg">See This Week</ButtonLink>
              </div>
            </Card>
          )}

          {/* week strip */}
          <Card>
            <div className="flex items-baseline justify-between gap-4">
              <p className="eyebrow">This week</p>
              <p className="text-xs opacity-55">
                <span className="font-semibold text-ink-900">{data.week.completed}</span> of{' '}
                {data.week.scheduled} sessions
              </p>
            </div>

            <ol className="mt-6 grid grid-cols-7 gap-2">
              {data.week.days.map((day, index) => {
                const rest = day.kind === 'rest';
                return (
                  <li key={day.id}>
                    <Link
                      href={rest ? '/app/plan' : `/workout/${day.id}`}
                      className="group block text-center"
                    >
                      <span className="block text-[0.625rem] uppercase tracking-[0.1em] opacity-45">
                        {WEEKDAYS[index]}
                      </span>
                      <span
                        className={`mt-2 grid aspect-square place-items-center rounded-[8px] border text-xs transition-all duration-200 group-hover:-translate-y-0.5 ${
                          day.status === 'completed'
                            ? 'border-signal-good/40 bg-signal-good/12 text-signal-good'
                            : day.status === 'skipped'
                              ? 'border-signal-bad/35 bg-signal-bad/10 text-signal-bad'
                              : rest
                                ? 'border-ink-900/10 bg-ink-900/[0.02] text-smoke-400'
                                : 'border-ink-900/15 bg-bone-100'
                        }`}
                      >
                        <span aria-hidden>
                          {day.status === 'completed' ? '✓' : day.status === 'skipped' ? '×' : rest ? '–' : '○'}
                        </span>
                        <span className="sr-only">
                          {day.title}: {rest ? 'rest day' : day.status}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>

            <div className="mt-6">
              <ProgressBar
                value={data.week.completed}
                max={Math.max(1, data.week.scheduled)}
                label="Weekly adherence"
                valueLabel={`${data.week.adherencePercent}%`}
                tone={data.week.adherencePercent >= 80 ? 'good' : 'accent'}
              />
            </div>
          </Card>

          {/* metric grid */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Training streak"
              value={`${data.streak.current}`}
              unit="days"
              hint={`Longest ${data.streak.longest}`}
            />
            <MetricCard
              label="Sleep"
              value={formatSleep(data.metrics.sleepMinutes)}
              hint="Last night"
            />
            <MetricCard
              label="Steps"
              value={data.metrics.steps ? formatNumber(data.metrics.steps) : '—'}
              hint={`of ${formatNumber(data.metrics.stepsTarget)}`}
              progress={
                data.metrics.steps
                  ? Math.round((data.metrics.steps / data.metrics.stepsTarget) * 100)
                  : undefined
              }
            />
            <MetricCard
              label="Recovery"
              value={`${data.recoveryScore}`}
              hint="Composite score"
              progress={data.recoveryScore}
            />
          </div>
        </div>

        {/* ------------------------------------------------------- sidebar */}
        <div className="min-w-0 space-y-6">
          {data.nutrition ? (
            <Card>
              <div className="flex items-baseline justify-between gap-4">
                <p className="eyebrow">Nutrition today</p>
                <Link href="/app/nutrition" className="text-xs font-semibold text-ember">Open →</Link>
              </div>
              <p className="display mt-3 text-display-sm tabular-nums">
                {formatNumber(data.nutrition.consumedCalories)}
                <span className="text-base font-normal opacity-45"> / {formatNumber(data.nutrition.targets.calories)} kcal</span>
              </p>
              <div className="mt-6 space-y-4">
                <ProgressBar
                  value={data.nutrition.consumedProtein}
                  max={data.nutrition.targets.proteinGrams}
                  label="Protein"
                  valueLabel={`${data.nutrition.consumedProtein} / ${data.nutrition.targets.proteinGrams}g`}
                />
                <ProgressBar
                  value={data.metrics.waterMl ?? 0}
                  max={data.metrics.waterTargetMl}
                  label="Water"
                  valueLabel={`${((data.metrics.waterMl ?? 0) / 1000).toFixed(1)} / ${(data.metrics.waterTargetMl / 1000).toFixed(1)}L`}
                  tone="neutral"
                />
              </div>
            </Card>
          ) : (
            <Card>
              <EmptyState
                icon="◐"
                title="No nutrition targets yet"
                body="Add your height and weight and FORGE will calculate targets rather than guess them."
                action={<ButtonLink href="/app/profile" size="sm">Complete Profile</ButtonLink>}
              />
            </Card>
          )}

          <Card>
            <p className="eyebrow mb-4">Training load</p>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="display text-2xl leading-none tabular-nums">
                  {data.load.ratio > 0 ? data.load.ratio.toFixed(2) : '—'}
                </p>
                <p className="mt-1 text-[0.6875rem] uppercase tracking-[0.1em] opacity-45">Acute : chronic</p>
              </div>
              <Chip tone={loadTone(data.load.zone)}>{data.load.zone.replace(/-/g, ' ')}</Chip>
            </div>
            <p className="mt-4 text-xs leading-relaxed opacity-65">{data.load.message}</p>
          </Card>

          <Card>
            <p className="eyebrow mb-4">Readiness inputs</p>
            {data.readiness.components.length === 0 ? (
              <p className="text-sm opacity-60">
                Connect a wearable or log how you slept to see the breakdown.
              </p>
            ) : (
              <ul className="space-y-4">
                {data.readiness.components.map((component) => (
                  <li key={component.key}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm">{component.label}</span>
                      <span className="text-xs tabular-nums opacity-55">{Math.round(component.score)}</span>
                    </div>
                    <p className="mt-1 text-[0.6875rem] opacity-50">{component.detail}</p>
                    <div className="mt-2">
                      <ProgressBar value={component.score} tone={component.score >= 70 ? 'good' : 'warn'} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {data.nextEvent && (
            <Card tone="dark">
              <p className="eyebrow mb-3">Next up</p>
              <p className="font-semibold text-bone-100">{data.nextEvent.title}</p>
              <p className="mt-1 text-xs text-bone-200/55">
                {data.nextEvent.date} · {String(Math.floor(data.nextEvent.startMinutes / 60)).padStart(2, '0')}:
                {String(data.nextEvent.startMinutes % 60).padStart(2, '0')}
              </p>
              <div className="mt-5">
                <ButtonLink href="/app/calendar" variant="inverse" size="sm" block>Open Calendar</ButtonLink>
              </div>
            </Card>
          )}

          <Card>
            <p className="eyebrow mb-4">Ask FORGE AI</p>
            <ul className="space-y-2">
              {['What should I train today?', 'Why did my recovery score fall?', 'What should I eat after training?'].map(
                (question) => (
                  <li key={question}>
                    <Link
                      href={`/app/ai?q=${encodeURIComponent(question)}`}
                      className="block rounded-[8px] border border-ink-900/10 px-4 py-3 text-sm transition-colors hover:border-ink-900/30 hover:bg-ink-900/[0.02]"
                    >
                      {question}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </Card>
        </div>
      </div>
    </AppSection>
  );
}

function MetricCard({
  label, value, unit, hint, progress,
}: { label: string; value: string; unit?: string; hint?: string; progress?: number }) {
  return (
    <Card>
      <p className="eyebrow">{label}</p>
      <p className="display mt-2 text-2xl leading-none tabular-nums">
        {value}
        {unit && <span className="ml-1 text-sm font-normal opacity-45">{unit}</span>}
      </p>
      {hint && <p className="mt-1.5 text-xs opacity-50">{hint}</p>}
      {typeof progress === 'number' && (
        <div className="mt-4"><ProgressBar value={progress} tone={progress >= 80 ? 'good' : 'accent'} /></div>
      )}
    </Card>
  );
}

function readinessTone(band: Readiness['band']): 'good' | 'accent' | 'warn' | 'bad' | 'neutral' {
  if (band === 'primed' || band === 'ready') return 'good';
  if (band === 'moderate') return 'warn';
  if (band === 'compromised') return 'bad';
  return 'neutral';
}

function loadTone(zone: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (zone === 'optimal') return 'good';
  if (zone === 'stretched') return 'warn';
  if (zone === 'spike') return 'bad';
  return 'neutral';
}

function weekNumber(startDate: string, today: string): number {
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000,
  );
  return Math.max(1, Math.floor(days / 7) + 1);
}
