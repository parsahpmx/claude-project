import Link from 'next/link';
import { ButtonLink, Card } from '@/components/ui/primitives';
import { RouteGlyph } from '@/components/marketing/route-glyph';

export const metadata = {
  description:
    'FORGE is a personal performance network: structured training, activity tracking, routes and maps, and progress that means something. Free while in beta.',
};

/** The four things the product actually does, in the order it does them. */
const PILLARS = [
  {
    eyebrow: 'Train',
    title: 'A plan that answers what to do today',
    body: 'Structured strength and running programmes with real progression — phases, loads and reps that move because you moved them, not because a calendar rolled over.',
    href: '/training',
  },
  {
    eyebrow: 'Track',
    title: 'Every session, strength included',
    body: 'Runs, rides, walks and hikes with splits and elevation. Sets, reps, load and RPE for the barbell work most activity trackers ignore.',
    href: '/features',
  },
  {
    eyebrow: 'Explore',
    title: 'Routes and maps that use the screen',
    body: 'Build a route, save one you found, and see your own history on a private map. Full-width on desktop, because a map in a small card is not a map.',
    href: '/maps',
  },
  {
    eyebrow: 'Progress',
    title: 'Numbers that explain themselves',
    body: 'Load balance, consistency and personal records, each defined in plain terms. If FORGE shows you a figure, it can tell you how it got there.',
    href: '/features',
  },
];

export default function LandingPage() {
  return (
    <>
      {/* Hero — one message, two actions, and the product's own material as the
          image. Sized to its content rather than to the viewport, so the page
          below it is visible in the first frame. */}
      <section className="relative overflow-hidden border-b border-ink-600/60">
        <div aria-hidden className="pointer-events-none absolute inset-0 text-signal/25">
          <RouteGlyph seed="forge-hero-primary" className="absolute -right-[10%] -top-[15%] h-[130%] w-[70%]" strokeWidth={1.2} showMarkers={false} />
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ink-900 via-ink-900/85 to-transparent" />

        <div className="shell relative py-20 sm:py-28">
          <p className="eyebrow">Personal performance network</p>
          <h1 className="mt-5 max-w-3xl text-hero font-display text-bone-100 text-balance">
            Train. Track. Go further.
          </h1>
          <p className="mt-6 max-w-xl text-body muted">
            Structured training and honest tracking in one place — the barbell and the
            10K, the plan and the run you actually did. Free while we are in beta.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <ButtonLink href="/signup" size="lg">Start free beta</ButtonLink>
            <ButtonLink href="/features" size="lg" variant="ghost">Explore FORGE</ButtonLink>
          </div>
          <p className="mt-6 text-caption muted">
            No card required · Your activities are private by default
          </p>
        </div>
      </section>

      {/* What it does */}
      <section className="shell py-20">
        <h2 className="text-display font-display text-bone-100 text-balance">
          One place for the whole athlete
        </h2>
        <p className="mt-4 max-w-prose text-body muted">
          Most tools do endurance or they do the gym. If you do both, you end up
          keeping two histories that never meet. FORGE keeps one.
        </p>

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {PILLARS.map((pillar) => (
            <Card key={pillar.eyebrow} as="article" interactive className="flex flex-col">
              <p className="eyebrow text-signal">{pillar.eyebrow}</p>
              <h3 className="mt-3 text-section text-bone-100">{pillar.title}</h3>
              <p className="mt-2.5 flex-1 text-secondary muted">{pillar.body}</p>
              <Link href={pillar.href} className="mt-5 text-secondary font-semibold text-signal hover:underline underline-offset-4">
                Learn more →
              </Link>
            </Card>
          ))}
        </div>
      </section>

      {/* Privacy, stated up front rather than buried in settings. */}
      <section className="border-y border-ink-600/60 bg-ink-800/40 py-20">
        <div className="shell grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <p className="eyebrow text-signal">Privacy</p>
            <h2 className="mt-4 text-display font-display text-bone-100 text-balance">
              Your map is yours until you say otherwise
            </h2>
            <p className="mt-5 max-w-prose text-body muted">
              New accounts start followers-only, with routes private and the start and
              end of every activity trimmed before anyone else can see it. The raw GPS
              trace is stored where no sharing rule can reach it — what other people
              see is a separate, sanitized line.
            </p>
            <ul className="mt-6 space-y-2.5">
              {[
                'Private zones you draw yourself, excluded everywhere',
                'Per-activity visibility, not one global switch',
                'Follower approval on by default',
              ].map((item) => (
                <li key={item} className="flex gap-3 text-secondary">
                  <span aria-hidden className="text-signal">—</span>
                  <span className="muted">{item}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <ButtonLink href="/privacy" variant="ghost">Read the privacy approach</ButtonLink>
            </div>
          </div>

          <Card padded={false} className="overflow-hidden">
            <div className="relative aspect-[4/3] text-signal">
              <RouteGlyph seed="forge-privacy-trim" className="absolute inset-0 h-full w-full" strokeWidth={2} />
            </div>
            <div className="border-t border-ink-600 p-5">
              <p className="text-card-title text-bone-100">Trimmed before it is shared</p>
              <p className="mt-1.5 text-secondary muted">
                The hollow marker is where the public line ends — not where you stopped.
              </p>
            </div>
          </Card>
        </div>
      </section>

      {/* Final CTA */}
      <section className="shell py-24 text-center">
        <h2 className="mx-auto max-w-2xl text-display font-display text-bone-100 text-balance">
          Build the habit. Keep the record. Go further.
        </h2>
        <p className="mx-auto mt-5 max-w-prose text-body muted">
          FORGE is in open beta and free to use while we get it right.
        </p>
        <div className="mt-9 flex justify-center gap-3">
          <ButtonLink href="/signup" size="lg">Start free beta</ButtonLink>
        </div>
      </section>
    </>
  );
}
