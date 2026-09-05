import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card, Chip, Stat } from '@/components/ui/primitives';
import { BarChart, DonutChart, Heatmap, LineChart } from '@/components/ui/charts';
import { EmptyState } from '@/components/ui/feedback';
import { apiFetch } from '@/lib/api';
import { formatLoad, formatNumber, formatVolume, formatDateLabel } from '@/lib/format';

export const metadata = { title: 'Progress' };

export const dynamic = 'force-dynamic';

interface ProgressResponse {
  summary: {
    totalWorkouts: number; trainingHours: number; totalVolumeGrams: number;
    totalCalories: number; currentStreakDays: number; longestStreakDays: number; weeklyAverage: number;
  };
  weeklyVolume: { date: string; value: number }[];
  heatmap: { date: string; count: number; intensity: number }[];
  muscleDistribution: { group: string; sessions: number; share: number }[];
  personalRecords: {
    id: string; exerciseName: string; kind: string; valueGrams: number;
    previousValueGrams: number; reps: number; achievedOn: string;
  }[];
  strengthTrends: {
    exerciseId: string; name: string; points: { date: string; estimatedOneRepMax: number }[];
    startGrams: number; currentGrams: number; changeGrams: number; changePercent: number;
  }[];
  bodyweight: { raw: { date: string; value: number }[]; smoothed: { date: string; value: number }[] };
  recovery: {
    date: string; readiness: number | null; recovery: number | null;
    sleepMinutes: number | null; hrv: number | null; restingHeartRate: number | null;
  }[];
  cardio: { restingHeartRate: number | null; maxHeartRate: number; vo2MaxEstimate: number | null };
  measurements: { date: string; weightGrams: number | null; bodyFatPercent: number | null } | null;
}

export default async function ProgressPage() {
  const data = await apiFetch<ProgressResponse>('/v1/me/progress');
  const { summary } = data;

  return (
    <AppSection>
      <PageHeader
        eyebrow="Progress"
        title="PROGRESS YOU CAN SEE."
        lead="Every series here is built from sessions you actually logged. Gaps stay visible — nothing is interpolated to make a bad month look better."
      />

      <nav aria-label="Progress sections" className="mt-6 flex flex-wrap gap-2">
        {['Overview', 'Strength', 'Body', 'Cardio', 'Consistency', 'Recovery'].map((label, index) => (
          <a
            key={label}
            href={`#${label.toLowerCase()}`}
            className={`min-h-[40px] rounded-pill border px-4 text-xs font-medium leading-[38px] transition-colors ${
              index === 0 ? 'dark-surface border-ink-900 bg-ink-900 text-bone-100' : 'border-ink-900/15 hover:border-ink-900/40'
            }`}
          >
            {label}
          </a>
        ))}
      </nav>

      {/* ------------------------------------------------------- overview */}
      <section id="overview" className="mt-10 scroll-mt-24">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card><Stat label="Total workouts" value={formatNumber(summary.totalWorkouts)} hint={`${summary.weeklyAverage} a week`} /></Card>
          <Card><Stat label="Training hours" value={`${summary.trainingHours}h`} hint="Last 90 days" /></Card>
          <Card><Stat label="Total volume" value={formatVolume(summary.totalVolumeGrams)} hint="Load × reps" /></Card>
          <Card><Stat label="Current streak" value={`${summary.currentStreakDays}d`} hint={`Longest ${summary.longestStreakDays}d`} /></Card>
        </div>
      </section>

      {/* ------------------------------------------------------- strength */}
      <section id="strength" className="mt-12 scroll-mt-24">
        <h2 className="eyebrow mb-5">Strength progression</h2>
        {data.strengthTrends.length === 0 ? (
          <EmptyState
            icon="◤"
            title="No strength trend yet"
            body="Log a few sessions on the same lift and the estimated one-rep max curve appears here."
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {data.strengthTrends.map((trend) => (
              <Card key={trend.exerciseId}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">{trend.name}</h3>
                    <p className="mt-1 text-xs text-muted">Estimated one-rep max</p>
                  </div>
                  <Chip tone={trend.changeGrams >= 0 ? 'good' : 'warn'} size="sm">
                    {trend.changeGrams >= 0 ? '+' : ''}{trend.changePercent}%
                  </Chip>
                </div>

                <p className="display mt-4 text-2xl tabular-nums">
                  {formatLoad(trend.startGrams)} <span className="text-muted">→</span> {formatLoad(trend.currentGrams)}
                </p>

                <div className="mt-5">
                  <LineChart
                    label={trend.name}
                    points={trend.points.map((p) => ({ date: p.date, value: p.estimatedOneRepMax }))}
                    format={(v) => formatLoad(v)}
                    height={130}
                  />
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------- PR timeline */}
      <section className="mt-12">
        <h2 className="eyebrow mb-5">Personal record timeline</h2>
        {data.personalRecords.length === 0 ? (
          <EmptyState icon="★" title="No records yet" body="Your first logged working set becomes your first record." />
        ) : (
          <Card padded={false}>
            <ul className="divide-y divide-ink-900/8">
              {data.personalRecords.slice(0, 12).map((record) => (
                <li key={record.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div className="flex items-center gap-4">
                    <span aria-hidden className="accent-tint grid h-10 w-10 place-items-center rounded-full bg-ember/12 text-accent">★</span>
                    <div>
                      <p className="font-medium">{record.exerciseName}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {record.kind === 'load' ? 'Heaviest load' : 'Estimated 1RM'} · {record.reps} reps ·{' '}
                        {formatDateLabel(record.achievedOn)}
                      </p>
                    </div>
                  </div>
                  <p className="text-right">
                    <span className="display text-lg tabular-nums">{formatLoad(record.valueGrams)}</span>
                    {record.previousValueGrams > 0 && (
                      <span className="block text-xs text-muted">was {formatLoad(record.previousValueGrams)}</span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* --------------------------------------------------- consistency */}
      <section id="consistency" className="mt-12 scroll-mt-24">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="eyebrow mb-5">Weekly training volume</h2>
            <BarChart
              label="Weekly volume"
              points={data.weeklyVolume.map((p) => ({ date: p.date, value: p.value }))}
              format={(v) => formatVolume(v)}
            />
          </Card>

          <Card>
            <h2 className="eyebrow mb-5">Training consistency</h2>
            <Heatmap cells={data.heatmap} label="Training consistency" />
          </Card>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="eyebrow mb-5">Muscle group distribution</h2>
            <DonutChart
              label="Muscle group distribution"
              segments={data.muscleDistribution.map((entry) => ({
                label: entry.group,
                value: entry.sessions,
                share: entry.share,
              }))}
            />
          </Card>

          <Card id="body">
            <h2 className="eyebrow mb-5">Bodyweight</h2>
            {data.bodyweight.raw.length < 2 ? (
              <EmptyState icon="◐" title="Not enough measurements" body="Log your weight weekly and the trend line appears here." />
            ) : (
              <>
                <LineChart
                  label="Bodyweight"
                  points={data.bodyweight.smoothed}
                  comparison={data.bodyweight.raw}
                  format={(v) => `${v.toFixed(1)} kg`}
                />
                <p className="mt-4 text-xs leading-relaxed text-muted">
                  The solid line is a four-week moving average; the dotted line is your raw measurements.
                  Bodyweight moves a kilo or two a day on water alone, so the average is the honest one.
                </p>
              </>
            )}
          </Card>
        </div>
      </section>

      {/* ------------------------------------------------ cardio & recovery */}
      <section id="cardio" className="mt-12 scroll-mt-24">
        <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
          <Card>
            <h2 className="eyebrow mb-5">Cardio markers</h2>
            <dl className="space-y-6">
              <Stat inList
                label="Resting heart rate"
                value={data.cardio.restingHeartRate ? `${data.cardio.restingHeartRate}` : '—'}
                hint="bpm, most recent"
              />
              <Stat inList label="Estimated max HR" value={`${data.cardio.maxHeartRate}`} hint="Age-predicted (Tanaka)" />
              <Stat inList
                label="VO₂ max estimate"
                value={data.cardio.vo2MaxEstimate ? `${data.cardio.vo2MaxEstimate}` : '—'}
                hint="ml/kg/min, from resting HR"
              />
            </dl>
            <p className="mt-6 text-xs leading-relaxed text-muted">
              Both are estimates from heart rate, not laboratory measurements. Track the direction, not the
              absolute number.
            </p>
          </Card>

          <Card id="recovery">
            <h2 className="eyebrow mb-5">Recovery trend</h2>
            <LineChart
              label="Readiness"
              points={data.recovery
                .filter((r) => r.readiness !== null)
                .map((r) => ({ date: r.date, value: r.readiness ?? 0 }))}
              format={(v) => String(Math.round(v))}
              height={180}
            />
            <div className="mt-6 grid grid-cols-3 gap-4">
              <Stat
                label="Avg readiness"
                value={String(average(data.recovery.map((r) => r.readiness)))}
                hint="Last 90 days"
              />
              <Stat
                label="Avg sleep"
                value={`${Math.floor(average(data.recovery.map((r) => r.sleepMinutes)) / 60)}h`}
                hint="Per night"
              />
              <Stat
                label="Avg HRV"
                value={`${average(data.recovery.map((r) => r.hrv))}`}
                hint="ms"
              />
            </div>
          </Card>
        </div>
      </section>
    </AppSection>
  );
}

function average(values: (number | null)[]): number {
  const present = values.filter((v): v is number => typeof v === 'number');
  if (present.length === 0) return 0;
  return Math.round(present.reduce((a, b) => a + b, 0) / present.length);
}
