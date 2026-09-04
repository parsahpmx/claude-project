import { Section, SectionHeading, Card, ButtonLink, Media, Chip } from '@/components/ui/primitives';
import { ProgressRing } from '@/components/ui/charts';
import { formatMinutes } from '@/lib/format';
import { apiPublic } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Recovery',
  description: 'Mobility, sleep, breathing and recovery protocols — scheduled as work, not as an afterthought.',
};

interface RecoverySession {
  id: string; slug: string; name: string; category: string; minutes: number;
  level: string; description: string; imageKey: string; hasCaptions: boolean;
}

export default async function RecoveryPage() {
  const { sessions } = await apiPublic<{ sessions: RecoverySession[] }>('/v1/catalog/recovery');
  const categories = [...new Set(sessions.map((s) => s.category))];

  return (
    <>
      <Section tone="dark" size="lg">
        <div className="grid gap-12 pt-16 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <p className="eyebrow mb-6">Recovery</p>
            <h1 className="display text-display-lg text-balance">TRAINING IS THE STIMULUS. RECOVERY IS THE ADAPTATION.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-bone-200/70">
              FORGE scores your readiness every morning from sleep, HRV, resting heart rate and how you actually
              feel — then tells you whether today is a push day or a hold day, and why.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/assessment" size="lg">Start Free Trial</ButtonLink>
              <ButtonLink href="#sessions" variant="inverse" size="lg">Browse Sessions</ButtonLink>
            </div>
          </div>

          <Card tone="dark">
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="eyebrow">Today&rsquo;s recovery score</p>
                <p className="display mt-2 text-display-sm text-bone-100">86</p>
                <p className="mt-1 text-sm text-bone-200/60">Ready — run the session as written</p>
              </div>
              <ProgressRing value={86} label="Recovery" tone="good" />
            </div>
            <div className="rule my-7" />
            <ul className="space-y-4">
              {[
                ['Sleep', '7h 42m against a 7h 30m baseline', 92],
                ['HRV', '68 ms against a 62 ms baseline', 88],
                ['Resting HR', '55 bpm, −3 vs baseline', 84],
                ['Soreness', 'Reported 2 of 5', 78],
              ].map(([label, detail, score]) => (
                <li key={label as string}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-sm text-bone-100">{label}</span>
                    <span className="text-xs tabular-nums text-bone-200/60">{score}</span>
                  </div>
                  <p className="mt-1 text-xs text-bone-200/45">{detail}</p>
                  <div className="mt-2 h-1 overflow-hidden rounded-pill bg-bone-200/10">
                    <div className="h-full rounded-pill bg-ember" style={{ width: `${score as number}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      <Section tone="light" size="md">
        <SectionHeading
          eyebrow="How readiness works"
          title="A NUMBER YOU CAN ARGUE WITH."
          lead="Every input is scored against your own rolling baseline, not a population average — and when an input is missing we drop it and renormalise rather than inventing a value."
        />
        <div className="mt-12 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {[
            ['Sleep · 30%', 'Duration against your own average, not a universal eight hours.'],
            ['HRV · 30%', 'Overnight average against your baseline. Direction matters more than the number.'],
            ['Resting heart rate · 15%', 'Inverted: a rise above your baseline is the warning signal.'],
            ['Soreness · 15%', 'Self-reported. It is a signal, not a verdict — soreness tracks novelty more than quality.'],
            ['Stress · 10%', 'Life load counts. A hard week at work costs the same recovery as a hard week of training.'],
            ['Missing data', 'Dropped and renormalised. FORGE never fills a gap with a number you did not record.'],
          ].map(([title, body]) => (
            <Card key={title}>
              <p className="font-semibold">{title}</p>
              <p className="mt-2 text-sm leading-relaxed opacity-65">{body}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section tone="bone" size="md" id="sessions">
        <SectionHeading eyebrow="Sessions" title="TEN MINUTES THAT CHANGE THE NEXT SESSION." />
        <div className="mt-8 flex flex-wrap gap-2">
          {categories.map((category) => <Chip key={category}>{category}</Chip>)}
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {sessions.map((session) => (
            <Card key={session.slug} interactive>
              <div className="mb-5 overflow-hidden rounded-[10px]">
                <Media imageKey={session.imageKey} ratio="16/9" rounded={false} alt={session.name} />
              </div>
              <div className="flex items-center gap-2">
                <p className="eyebrow">{session.category}</p>
                <span aria-hidden className="h-1 w-1 rounded-full bg-current opacity-30" />
                <p className="text-[0.6875rem] opacity-55">{formatMinutes(session.minutes)}</p>
              </div>
              <h3 className="mt-2 font-semibold leading-snug">{session.name}</h3>
              <p className="mt-2 text-sm leading-relaxed opacity-65">{session.description}</p>
              {session.hasCaptions && (
                <p className="mt-4 text-[0.6875rem] uppercase tracking-[0.1em] opacity-45">
                  <span aria-hidden>CC</span> Captions available
                </p>
              )}
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}
