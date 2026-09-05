import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card, Chip } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/feedback';
import { ProgressBar } from '@/components/ui/charts';
import { JoinChallengeButton } from '@/components/app/join-challenge';
import { apiFetch } from '@/lib/api';
import { formatNumber } from '@/lib/format';

export const metadata = { title: 'Challenges' };

export const dynamic = 'force-dynamic';

interface ChallengeBoard {
  challenge: {
    slug: string; name: string; tagline: string; metric: string;
    target: number; durationDays: number; badge: string; rules: string[];
  };
  participants: number;
  joined: boolean;
  progress: {
    value: number; target: number; percent: number; remaining: number;
    daysRemaining: number; requiredDailyRate: number; onTrack: boolean; message: string;
  } | null;
  leaderboard: {
    rank: number; userId: string; displayName: string; value: number;
    progressPercent: number; completed: boolean; isFriend: boolean;
  }[];
  myRank: number | null;
}

export default async function ChallengesPage() {
  const { challenges } = await apiFetch<{ challenges: ChallengeBoard[] }>('/v1/me/challenges');

  return (
    <AppSection>
      <PageHeader
        eyebrow="Challenges"
        title="COMPETE WITH YOURSELF FIRST."
        lead="Every challenge measures an action you control — sessions, steps, minutes moved. None of them measure weight lost."
      />

      <div className="mt-10 space-y-6">
        {challenges.map((board) => (
          <Card key={board.challenge.slug} padded={false}>
            <div className="grid gap-px bg-ink-900/8 lg:grid-cols-[1.4fr_1fr]">
              <div className="light-surface bg-bone-100 p-6 sm:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="display text-display-sm">{board.challenge.name}</h2>
                    <p className="mt-2 text-sm text-muted">{board.challenge.tagline}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge earned={board.progress?.percent === 100}>{board.challenge.badge}</Badge>
                    <Chip size="sm">{board.challenge.durationDays} days</Chip>
                  </div>
                </div>

                {board.progress ? (
                  <div className="mt-7">
                    <div className="flex items-baseline justify-between gap-4">
                      <p className="display text-2xl tabular-nums">
                        {formatNumber(board.progress.value)}
                        <span className="text-base font-normal text-muted"> / {formatNumber(board.progress.target)}</span>
                      </p>
                      <Chip tone={board.progress.onTrack ? 'good' : 'warn'} size="sm">
                        {board.progress.onTrack ? 'On track' : 'Behind pace'}
                      </Chip>
                    </div>
                    <div className="mt-4">
                      <ProgressBar
                        value={board.progress.value}
                        max={board.progress.target}
                        tone={board.progress.onTrack ? 'good' : 'warn'}
                      />
                    </div>
                    <p className="mt-4 text-sm leading-relaxed text-muted">{board.progress.message}</p>
                    <p className="mt-2 text-xs text-muted">
                      {board.progress.daysRemaining} days remaining
                      {board.myRank ? ` · currently ranked #${board.myRank}` : ''}
                    </p>
                  </div>
                ) : (
                  <div className="mt-7">
                    <ul className="space-y-2">
                      {board.challenge.rules.map((rule) => (
                        <li key={rule} className="flex gap-2.5 text-sm text-muted">
                          <span aria-hidden className="text-accent">·</span>
                          {rule}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-7 flex flex-wrap items-center gap-4">
                  <JoinChallengeButton slug={board.challenge.slug} joined={board.joined} />
                  <span className="text-xs text-muted">
                    {formatNumber(board.participants)} members taking part
                  </span>
                </div>
              </div>

              <div className="light-surface bg-bone-100 p-6 sm:p-8">
                <p className="eyebrow mb-5">Leaderboard</p>
                {board.leaderboard.length === 0 ? (
                  <p className="text-sm text-muted">No public entries yet.</p>
                ) : (
                  <ol className="space-y-3">
                    {board.leaderboard.map((row) => (
                      <li key={row.userId} className="flex items-center gap-4">
                        <span
                          aria-hidden
                          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums ${
                            row.rank <= 3 ? 'accent-tint bg-ember/12 text-chip-accent' : 'bg-ink-900/[0.05] opacity-60'
                          }`}
                        >
                          {row.rank}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {row.displayName}
                          {row.isFriend && <span className="ml-2 text-[0.625rem] uppercase tracking-[0.1em] text-accent">Following</span>}
                        </span>
                        <span className="shrink-0 text-sm tabular-nums text-muted">
                          {formatNumber(row.value)}
                        </span>
                        {row.completed && <span aria-hidden className="text-status-good">✓</span>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </AppSection>
  );
}
