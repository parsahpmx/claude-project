import Link from 'next/link';
import { consistency } from '@forge/contracts';
import { Card, Badge, EmptyState } from '@/components/ui/primitives';
import { createClient } from '@/lib/supabase/server';
import { getUpcomingPlanDays } from '@/lib/queries';
import { isoDate, addDays, startOfWeek, formatDate, SPORT_LABEL } from '@/lib/format';

export const metadata = { title: 'Training' };
export const dynamic = 'force-dynamic';

/**
 * Training home: the current plan, this week, and the catalogue if there is no
 * plan yet. One screen that answers "what am I on, and what is next".
 */
export default async function TrainingPage() {
  const supabase = await createClient();
  const today = isoDate(new Date());
  const weekStart = startOfWeek(today);

  const [{ data: plan }, days, { data: programs }] = await Promise.all([
    supabase
      .from('plans')
      .select('id, name, program_slug, start_date, weeks, status')
      .eq('status', 'active')
      .maybeSingle(),
    getUpcomingPlanDays(weekStart, addDays(weekStart, 13)),
    supabase
      .from('programs')
      .select('slug, name, tagline, sport, weeks, sessions_per_week, difficulty')
      .eq('published', true)
      .order('name')
      .limit(12),
  ]);

  const thisWeek = days.filter((d) => d.date >= weekStart && d.date <= addDays(weekStart, 6));
  const adherence = consistency(thisWeek, today);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-page-title font-display text-bone-100">Training</h1>
        <p className="mt-2 text-secondary muted">Your plan, your week, and what to run next.</p>
      </header>

      {plan ? (
        <section aria-labelledby="plan-heading">
          <h2 id="plan-heading" className="eyebrow mb-4">
            Current plan
          </h2>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-section text-bone-100">{plan.name || plan.program_slug}</p>
                <p className="mt-1.5 text-secondary muted">
                  {plan.weeks} weeks from {formatDate(plan.start_date)}
                </p>
              </div>
              {adherence !== null && (
                <Badge tone={adherence >= 70 ? 'good' : 'warn'}>{adherence}% this week</Badge>
              )}
            </div>
          </Card>

          <h3 className="eyebrow mb-3 mt-8">This week</h3>
          {thisWeek.length === 0 ? (
            <p className="text-secondary muted">Nothing scheduled this week.</p>
          ) : (
            <ul className="space-y-2.5">
              {thisWeek.map((day) => (
                <li key={day.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-ink-600 bg-ink-800 px-5 py-4">
                    <div className="min-w-0">
                      <p className="text-caption muted">{formatDate(day.date)}</p>
                      <p className="mt-0.5 text-card-title text-bone-100">
                        {day.title || (day.status === 'rest' ? 'Rest' : 'Session')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {day.sport && <Badge>{SPORT_LABEL[day.sport]}</Badge>}
                      {day.status === 'completed' && <Badge tone="good">✓ Done</Badge>}
                      {day.status === 'skipped' && <Badge tone="warn">Skipped</Badge>}
                      {day.status === 'rest' && <Badge>Rest</Badge>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <EmptyState
          title="No active plan"
          body="Pick a programme and FORGE will lay out the weeks, the sessions and the loads, then move them as you train."
        />
      )}

      <section aria-labelledby="catalogue-heading">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 id="catalogue-heading" className="eyebrow">
            Programmes
          </h2>
          <Link
            href="/programs"
            className="text-secondary font-semibold text-signal hover:underline underline-offset-4"
          >
            All programmes →
          </Link>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(programs ?? []).map((program) => (
            <li key={program.slug}>
              <Card interactive>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-card-title text-bone-100">{program.name}</h3>
                  <Badge>{SPORT_LABEL[program.sport] ?? program.sport}</Badge>
                </div>
                <p className="mt-2 text-secondary muted">{program.tagline}</p>
                <p className="mt-4 text-caption muted tabular-nums">
                  {program.weeks} weeks · {program.sessions_per_week}× a week · {program.difficulty}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
