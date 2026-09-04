import Link from 'next/link';
import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card, Chip, ButtonLink, Stat } from '@/components/ui/primitives';
import { ProgressRing } from '@/components/ui/charts';
import { Status, EmptyState } from '@/components/ui/feedback';
import { PlanWeekActions } from '@/components/app/plan-week-actions';
import { apiFetch } from '@/lib/api';
import { formatDateLabel, formatMinutes } from '@/lib/format';
import type { Phase, Plan, PlanDay, PlanWeek } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface PlanResponse {
  plan: Plan | null;
  weeks: PlanWeek[];
  currentWeek: PlanWeek | null;
  progress: { completedSessions: number; totalSessions: number; percent: number } | null;
  nextMilestone: string | null;
}

const PHASE_LABEL: Record<Phase['key'], string> = {
  foundation: 'Foundation',
  build: 'Build',
  perform: 'Perform',
};

export default async function PlanPage() {
  const data = await apiFetch<PlanResponse>('/v1/me/plan');

  if (!data.plan || !data.progress) {
    return (
      <AppSection>
        <PageHeader eyebrow="My plan" title="YOUR ROADMAP" />
        <div className="mt-10">
          <EmptyState
            icon="▤"
            title="No active plan yet"
            body="Pick a programme and FORGE builds the full block — every week, every session, every load — before you train once."
            action={<ButtonLink href="/app/programs">Browse Programs</ButtonLink>}
          />
        </div>
      </AppSection>
    );
  }

  const { plan, weeks, currentWeek, progress } = data;

  return (
    <AppSection>
      <PageHeader
        eyebrow="My plan"
        title="YOUR ROADMAP"
        lead={`${plan.programName} · ${plan.totalWeeks} weeks · ${plan.sessionsPerWeek} sessions a week`}
        action={<ButtonLink href="/app/programs" variant="ghost">Change Programme</ButtonLink>}
      />

      {/* ------------------------------------------------------ summary */}
      <div className="mt-10 grid min-w-0 gap-6 lg:grid-cols-[1fr_1.6fr]">
        <Card tone="dark">
          <div className="flex items-center gap-7">
            <ProgressRing value={progress.percent} size={112} sublabel="Complete" />
            <div>
              <p className="eyebrow">Goal</p>
              <p className="mt-2 text-lg font-semibold capitalize text-bone-100">
                {plan.goal.replace(/-/g, ' ')}
              </p>
              <p className="mt-4 text-xs text-bone-200/55">
                {progress.completedSessions} of {progress.totalSessions} sessions logged
              </p>
            </div>
          </div>

          {data.nextMilestone && (
            <>
              <div className="rule my-6" />
              <p className="eyebrow mb-2">Next milestone</p>
              <p className="text-sm text-bone-200/80">{data.nextMilestone}</p>
            </>
          )}
        </Card>

        <div className="grid gap-4 sm:grid-cols-3">
          {plan.phases.map((phase) => {
            const active = currentWeek !== null && currentWeek.phase === phase.key;
            return (
              <Card key={phase.key} tone={active ? 'dark' : 'light'}>
                <p className="eyebrow">Phase 0{phase.order}</p>
                <p className={`display mt-2 text-xl leading-none ${active ? 'text-bone-100' : ''}`}>
                  {PHASE_LABEL[phase.key]}
                </p>
                <p className="mt-2 text-xs opacity-55">
                  Weeks {phase.weekStart}–{phase.weekEnd}
                </p>
                <ul className="mt-4 space-y-1.5">
                  {phase.focus.map((item) => (
                    <li key={item} className="flex gap-2 text-xs opacity-70">
                      <span aria-hidden className="text-ember">·</span>
                      {item}
                    </li>
                  ))}
                </ul>
                {active && <div className="mt-4"><Chip tone="accent" size="sm">Current phase</Chip></div>}
              </Card>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------------ timeline */}
      <div className="mt-12">
        <p className="eyebrow mb-4">The twelve weeks</p>
        <ol className="scroll-x scrollbar-none flex gap-2 pb-2">
          {weeks.map((week) => {
            const done = week.days.filter((d) => d.status === 'completed').length;
            const total = week.days.filter((d) => d.kind !== 'rest').length;
            const current = currentWeek?.id === week.id;
            return (
              <li key={week.id} className="min-w-[86px] flex-1">
                <a href={`#week-${week.weekNumber}`} className="group block">
                  <div
                    className={`h-1.5 rounded-pill transition-colors ${
                      current ? 'bg-ember' : done === total && total > 0 ? 'bg-signal-good' : 'bg-ink-900/12'
                    }`}
                  />
                  <p className={`mt-2 text-xs font-semibold ${current ? 'text-ember' : 'opacity-60'}`}>
                    W{week.weekNumber}
                  </p>
                  <p className="mt-0.5 text-[0.625rem] uppercase tracking-[0.1em] opacity-40">
                    {week.deload ? 'Deload' : PHASE_LABEL[week.phase]}
                  </p>
                  <p className="mt-1 text-[0.625rem] tabular-nums opacity-45">{done}/{total}</p>
                </a>
              </li>
            );
          })}
        </ol>
      </div>

      {/* ------------------------------------------------------ weeks */}
      <div className="mt-10 space-y-6">
        {weeks.map((week) => (
          <WeekCard key={week.id} week={week} current={currentWeek?.id === week.id} />
        ))}
      </div>
    </AppSection>
  );
}

function WeekCard({ week, current }: { week: PlanWeek; current: boolean }) {
  const sessions = week.days.filter((d) => d.kind !== 'rest');
  const completed = sessions.filter((d) => d.status === 'completed').length;

  return (
    <section id={`week-${week.weekNumber}`} className="scroll-mt-24">
      <Card tone={current ? 'dark' : 'light'} padded={false}>
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-current/10 p-6">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="display text-xl leading-none">Week {week.weekNumber}</p>
              <Chip tone={current ? 'accent' : 'neutral'} size="sm">{PHASE_LABEL[week.phase]}</Chip>
              {week.deload && <Chip tone="warn" size="sm">Deload</Chip>}
              {week.coachCheckIn && <Chip size="sm">Coach check-in</Chip>}
            </div>
            <p className="mt-2 text-xs opacity-55">
              {formatDateLabel(week.startDate)} – {formatDateLabel(week.endDate)}
            </p>
          </div>

          <div className="flex items-center gap-6">
            <Stat label="Sessions" value={`${completed}/${sessions.length}`} tone={current ? 'dark' : 'light'} />
          </div>
        </div>

        <div className="grid gap-px bg-current/10 sm:grid-cols-2">
          <div className={`p-6 ${current ? 'bg-ink-800' : 'bg-bone-100'}`}>
            <p className="eyebrow mb-2">Nutrition goal</p>
            <p className="text-sm opacity-75">{week.nutritionGoal}</p>
          </div>
          <div className={`p-6 ${current ? 'bg-ink-800' : 'bg-bone-100'}`}>
            <p className="eyebrow mb-2">Recovery target</p>
            <p className="text-sm opacity-75">{week.recoveryTarget}</p>
          </div>
        </div>

        {week.milestone && (
          <div className="border-t border-current/10 bg-ember/[0.07] p-5">
            <p className="eyebrow mb-1 text-ember-600">Milestone</p>
            <p className="text-sm font-medium">{week.milestone}</p>
          </div>
        )}

        <ul className="divide-y divide-current/8 border-t border-current/10">
          {week.days.map((day) => (
            <DayRow key={day.id} day={day} dark={current} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

function DayRow({ day, dark }: { day: PlanDay; dark: boolean }) {
  const rest = day.kind === 'rest';

  return (
    <li className="flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="flex min-w-0 items-center gap-4">
        <span
          aria-hidden
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-[8px] border text-xs ${
            day.status === 'completed'
              ? 'border-signal-good/40 bg-signal-good/12 text-signal-good'
              : day.status === 'skipped'
                ? 'border-signal-bad/35 bg-signal-bad/10 text-signal-bad'
                : 'border-current/15'
          }`}
        >
          {day.status === 'completed' ? '✓' : day.status === 'skipped' ? '×' : rest ? '–' : day.dayOfWeek}
        </span>

        <div className="min-w-0">
          <p className={`font-medium ${rest ? 'opacity-50' : ''}`}>{day.title}</p>
          <p className="mt-0.5 text-xs opacity-50">
            {formatDateLabel(day.date)}
            {!rest && ` · ${day.focus} · ${formatMinutes(day.minutes)}`}
            {day.rescheduledFrom && ` · moved from ${formatDateLabel(day.rescheduledFrom)}`}
          </p>
        </div>
      </div>

      {!rest && (
        <div className="flex items-center gap-3">
          {day.status !== 'scheduled' ? (
            <Status status={day.status} />
          ) : (
            <>
              <PlanWeekActions dayId={day.id} date={day.date} minutes={day.minutes} />
              <Link
                href={`/workout/${day.id}`}
                className={`min-h-[40px] rounded-[8px] px-4 text-xs font-semibold uppercase leading-[38px] tracking-[0.08em] ${
                  dark ? 'bg-ember text-bone-100' : 'bg-ink-900 text-bone-100'
                }`}
              >
                Start
              </Link>
            </>
          )}
        </div>
      )}
    </li>
  );
}
