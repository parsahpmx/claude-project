import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card, Chip, Media } from '@/components/ui/primitives';
import { ProgressRing } from '@/components/ui/charts';
import { LogRecoveryButton } from '@/components/app/log-recovery';
import { apiFetch } from '@/lib/api';
import { formatMinutes, formatDateLabel } from '@/lib/format';

export const metadata = { title: 'Recovery' };

export const dynamic = 'force-dynamic';

interface RecoveryResponse {
  sessions: {
    id: string; slug: string; name: string; category: string; minutes: number;
    level: string; description: string; imageKey: string; hasCaptions: boolean;
  }[];
  categories: string[];
  logs: {
    log: { id: string; date: string; minutes: number };
    session: { name: string; category: string } | null;
  }[];
  minutesThisWeek: number;
}

export default async function RecoveryPage() {
  const [recovery, dashboard] = await Promise.all([
    apiFetch<RecoveryResponse>('/v1/me/recovery'),
    apiFetch<{ recoveryScore: number; readiness: { score: number | null; headline: string; guidance: string; components: { key: string; label: string; score: number; detail: string }[] } }>(
      '/v1/me/dashboard',
    ),
  ]);

  return (
    <AppSection>
      <PageHeader
        eyebrow="Recovery"
        title="TODAY'S RECOVERY"
        lead="Training is the stimulus. This is where the adaptation happens."
      />

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card tone="dark">
          <div className="flex items-center gap-7">
            <ProgressRing value={dashboard.recoveryScore} size={112} sublabel="Recovery" tone="good" />
            <div>
              <p className="eyebrow">Today</p>
              <p className="mt-2 text-lg font-semibold text-bone-100">{dashboard.readiness.headline}</p>
              <p className="mt-2 text-xs leading-relaxed text-bone-200/60">{dashboard.readiness.guidance}</p>
            </div>
          </div>

          <div className="rule my-6" />

          <p className="eyebrow mb-2">This week</p>
          <p className="display text-2xl tabular-nums text-bone-100">
            {formatMinutes(recovery.minutesThisWeek)}
          </p>
          <p className="mt-1 text-xs text-muted">of recovery work logged</p>
        </Card>

        <Card>
          <p className="eyebrow mb-5">What is driving your score</p>
          {dashboard.readiness.components.length === 0 ? (
            <p className="text-sm text-muted">
              Connect a wearable or log a morning check-in to see the breakdown.
            </p>
          ) : (
            <ul className="space-y-5">
              {dashboard.readiness.components.map((component) => (
                <li key={component.key}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{component.label}</span>
                    <span className="text-sm tabular-nums text-muted">{Math.round(component.score)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{component.detail}</p>
                  <div className="mt-2 h-1 overflow-hidden rounded-pill bg-ink-900/10">
                    <div
                      className={`h-full rounded-pill ${component.score >= 70 ? 'bg-signal-good' : 'bg-signal-warn'}`}
                      style={{ width: `${component.score}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <section className="mt-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="eyebrow">Recovery sessions</h2>
          <div className="flex flex-wrap gap-2">
            {recovery.categories.map((category) => <Chip key={category} size="sm">{category}</Chip>)}
          </div>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {recovery.sessions.map((session) => (
            <Card key={session.slug} padded={false}>
              <Media imageKey={session.imageKey} ratio="16/9" rounded={false} alt={session.name} />
              <div className="p-5">
                <div className="flex items-center gap-2">
                  <p className="eyebrow">{session.category}</p>
                  <span aria-hidden className="h-1 w-1 rounded-full bg-current opacity-30" />
                  <p className="text-[0.6875rem] text-muted">{formatMinutes(session.minutes)}</p>
                </div>
                <h3 className="mt-2 font-semibold leading-snug">{session.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{session.description}</p>
                <div className="mt-5 flex items-center justify-between gap-3">
                  <LogRecoveryButton slug={session.slug} minutes={session.minutes} />
                  {session.hasCaptions && (
                    <span className="text-[0.625rem] uppercase tracking-[0.1em] text-muted">
                      <span aria-hidden>CC</span> Captions
                    </span>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {recovery.logs.length > 0 && (
        <section className="mt-12">
          <h2 className="eyebrow mb-5">Recent recovery</h2>
          <Card padded={false}>
            <ul className="divide-y divide-ink-900/8">
              {recovery.logs.slice(0, 10).map((entry) => (
                <li key={entry.log.id} className="flex items-center justify-between gap-4 p-5">
                  <div>
                    <p className="font-medium">{entry.session?.name ?? 'Recovery session'}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatDateLabel(entry.log.date)}
                      {entry.session && ` · ${entry.session.category}`}
                    </p>
                  </div>
                  <span className="text-sm tabular-nums text-muted">{formatMinutes(entry.log.minutes)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </AppSection>
  );
}
