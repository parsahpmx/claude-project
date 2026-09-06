import { ButtonLink, Card } from '@/components/ui/primitives';
import { RouteGlyph } from '@/components/marketing/route-glyph';

export const metadata = {
  title: 'How it works',
  description: 'Assessment to plan to session to progress — the loop FORGE is built around.',
};

/** A genuine sequence, so numbering it carries information rather than decoration. */
const STEPS = [
  ['Answer five questions', 'Experience, goals, the sports you actually do, how many sessions fit your week, and who gets to see any of it.'],
  ['Get a plan with a shape', 'Phases, sessions and starting loads, laid across real dates rather than a generic week one.'],
  ['Train and record', 'Log the session, or record the run. Strength sessions keep sets, reps, load and RPE; distance sessions keep splits and climbing.'],
  ['The plan responds', 'Hit the prescription and the load moves. Miss a week and the next one is built from what you did, not what was hoped.'],
  ['Read the progress', 'Load balance, consistency and records — each with the arithmetic behind it written down.'],
] as const;

export default function HowItWorksPage() {
  return (
    <>
      <section className="shell border-b border-ink-600/60 py-16">
        <p className="eyebrow">How it works</p>
        <h1 className="mt-4 max-w-3xl text-display font-display text-bone-100 text-balance">
          One loop, run properly
        </h1>
        <p className="mt-5 max-w-prose text-body muted">
          Plan, train, record, adjust. Most tools do one part well and hand you the rest.
        </p>
      </section>

      <section className="shell py-16">
        <ol className="space-y-4">
          {STEPS.map(([title, body], i) => (
            <li key={title}>
              <Card className="flex gap-5">
                <span aria-hidden className="text-metric-l tabular-nums text-signal">{i + 1}</span>
                <div>
                  <h2 className="text-section text-bone-100">{title}</h2>
                  <p className="mt-2 max-w-prose text-secondary muted">{body}</p>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-ink-600/60 bg-ink-800/40 py-16">
        <div className="shell grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <h2 className="text-display font-display text-bone-100 text-balance">Maps that use the screen</h2>
            <p className="mt-5 max-w-prose text-body muted">
              Your recorded activities on one personal map, private to you. Route detail is
              always available as text as well, so nothing important is locked inside the tiles.
            </p>
            <div className="mt-8"><ButtonLink href="/signup">Start free beta</ButtonLink></div>
          </div>
          <Card padded={false} className="overflow-hidden">
            <div className="relative aspect-[4/3] text-signal">
              <RouteGlyph seed="forge-how-it-works" className="absolute inset-0 h-full w-full" strokeWidth={2} />
            </div>
          </Card>
        </div>
      </section>
    </>
  );
}
