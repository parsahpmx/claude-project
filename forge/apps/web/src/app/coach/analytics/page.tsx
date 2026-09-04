import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card, Stat } from '@/components/ui/primitives';
import { BarChart, LineChart } from '@/components/ui/charts';
import { EmptyState } from '@/components/ui/feedback';
import { apiFetch } from '@/lib/api';
import { formatCents } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface Analytics {
  activeClients: number;
  weeklyAdherence: number;
  retentionWeeks: number;
  checkInResponseRate: number;
  revenueCents: number;
  series: { weekStart: string; adherencePercent: number; sessions: number }[];
}

export default async function CoachAnalyticsPage() {
  const data = await apiFetch<Analytics>('/v1/coach/analytics');

  if (data.activeClients === 0) {
    return (
      <AppSection>
        <PageHeader eyebrow="Analytics" title="COACHING ANALYTICS" />
        <div className="mt-10">
          <EmptyState icon="◤" title="No data yet" body="Analytics appear once you have active clients." />
        </div>
      </AppSection>
    );
  }

  return (
    <AppSection>
      <PageHeader
        eyebrow="Analytics"
        title="IS YOUR COACHING LANDING?"
        lead="Adherence, retention and response rate — the three numbers that predict whether a client renews."
      />

      <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card><Stat label="Active clients" value={data.activeClients} /></Card>
        <Card><Stat label="Weekly adherence" value={`${data.weeklyAdherence}%`} hint="Across all clients" /></Card>
        <Card><Stat label="Avg retention" value={`${data.retentionWeeks}w`} hint="Time as your client" /></Card>
        <Card><Stat label="Check-in replies" value={`${data.checkInResponseRate}%`} hint="Answered" /></Card>
        <Card><Stat label="Monthly recurring" value={formatCents(data.revenueCents)} hint="At current roster" /></Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <p className="eyebrow mb-5">Adherence over time</p>
          <LineChart
            label="Weekly adherence"
            points={data.series.map((s) => ({ date: s.weekStart, value: s.adherencePercent }))}
            format={(v) => `${Math.round(v)}%`}
            height={180}
          />
          <p className="mt-5 text-xs leading-relaxed opacity-60">
            Adherence below 70% for two weeks running is the strongest predictor of a client leaving. It is
            almost never a motivation problem — it is a plan that stopped fitting their week.
          </p>
        </Card>

        <Card>
          <p className="eyebrow mb-5">Sessions completed per week</p>
          <BarChart
            label="Sessions completed"
            points={data.series.map((s) => ({ date: s.weekStart, value: s.sessions }))}
            format={(v) => `${Math.round(v)} sessions`}
          />
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <p className="eyebrow mb-5">Weekly breakdown</p>
          <div className="scroll-x">
            <table className="w-full min-w-[520px] text-sm">
              <caption className="sr-only">Adherence and sessions completed by week</caption>
              <thead>
                <tr className="border-b border-ink-900/10">
                  <th scope="col" className="py-3 text-left font-semibold">Week beginning</th>
                  <th scope="col" className="py-3 text-right font-semibold">Sessions</th>
                  <th scope="col" className="py-3 text-right font-semibold">Adherence</th>
                </tr>
              </thead>
              <tbody>
                {[...data.series].reverse().map((week) => (
                  <tr key={week.weekStart} className="border-b border-ink-900/6 last:border-0">
                    <th scope="row" className="py-3 text-left font-normal opacity-75">{week.weekStart}</th>
                    <td className="py-3 text-right tabular-nums">{week.sessions}</td>
                    <td className="py-3 text-right tabular-nums">
                      <span className={week.adherencePercent >= 80 ? 'text-signal-good' : week.adherencePercent >= 60 ? '' : 'text-signal-warn'}>
                        {week.adherencePercent}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </AppSection>
  );
}
