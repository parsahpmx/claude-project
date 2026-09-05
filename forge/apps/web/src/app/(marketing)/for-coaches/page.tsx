import { Section, SectionHeading, Card, ButtonLink, Media, Stat } from '@/components/ui/primitives';
import { CoachApplication } from '@/components/marketing/coach-application';

export const metadata = {
  title: 'For Coaches',
  description: 'Coach more. Admin less. Client management, program builder, payments and analytics in one place.',
};

const FEATURES = [
  ['Client management', 'Every client’s plan, history, check-ins and notes on one screen — with adherence surfaced before you have to look for it.'],
  ['Program builder', 'Drag-and-drop the week. Sets, reps, load, RPE, tempo, rest, notes and a video per exercise.'],
  ['Calendar', 'Consultations, coaching calls and check-in deadlines in one view, in your clients’ time zones.'],
  ['Video sessions', 'One-to-one calls with the session plan, your notes and their metrics beside the video.'],
  ['Messaging', 'Text, voice notes, video and documents. Form checks arrive with a timeline you can annotate.'],
  ['Payments', 'Subscriptions, one-off sessions and payouts, itemised. No chasing invoices.'],
  ['Progress tracking', 'Strength, volume, consistency and recovery per client, without exporting anything.'],
  ['Form reviews', 'Pin a note to the exact second. Your client sees it against the frame, not in a paragraph.'],
  ['Coach analytics', 'Retention, adherence and response rate — the numbers that tell you if your coaching is landing.'],
];

export default function ForCoachesPage() {
  return (
    <>
      <Section tone="dark" size="lg">
        <div className="grid gap-12 pt-16 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <p className="eyebrow mb-6">For coaches</p>
            <h1 className="display text-display-lg text-balance">COACH MORE.<br />ADMIN LESS.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-bone-200/70">
              Spreadsheets, a scheduling tool, a payments link, a messaging app and a video call — replaced by
              one workspace that already knows what your client did this week.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="#apply" size="lg">Apply as a Coach</ButtonLink>
              <ButtonLink href="/coach" variant="inverse" size="lg">See the Workspace</ButtonLink>
            </div>

            <dl className="mt-12 flex flex-wrap gap-x-12 gap-y-6">
              <Stat inList label="Client cap" value="40" hint="quality over volume" tone="dark" />
              <Stat inList label="Platform fee" value="15%" hint="no monthly charge" tone="dark" />
              <Stat inList label="Payouts" value="Weekly" hint="every Friday" tone="dark" />
            </dl>
          </div>
          <Media imageKey="coach-workspace" ratio="3/4" alt="Coach reviewing client progress" />
        </div>
      </Section>

      <Section tone="light" size="md">
        <SectionHeading eyebrow="The workspace" title="EVERYTHING IN ONE PLACE." />
        <div className="mt-12 grid gap-px overflow-hidden rounded-card border border-ink-900/10 bg-ink-900/10 sm:grid-cols-2 xl:grid-cols-3">
          {FEATURES.map(([title, body]) => (
            <div key={title} className="light-surface bg-bone-100 p-7">
              <div className="mb-4 h-px w-12 bg-ember" />
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="bone" size="md">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="eyebrow mb-5">Why the cap</p>
            <h2 className="display text-display-md text-balance">FORTY CLIENTS. NOT FOUR HUNDRED.</h2>
            <p className="mt-6 max-w-prose leading-relaxed text-muted">
              A coach with four hundred clients is sending templates. FORGE caps rosters at forty and shows
              your utilisation on your own dashboard, because the product only works if the coaching is real.
            </p>
            <p className="mt-5 max-w-prose leading-relaxed text-muted">
              Members can see how many slots you have open this week. Coaches at capacity are waitlisted rather
              than quietly oversubscribed — which is better for them, better for you, and the reason the
              average FORGE coaching relationship lasts longer than the industry norm.
            </p>
          </div>
          <Card>
            <p className="eyebrow mb-6">What we ask for</p>
            <ul className="space-y-4">
              {[
                ['A recognised qualification', 'Level 3 personal training or equivalent, plus any specialisms you claim.'],
                ['Insurance', 'Current professional indemnity and public liability.'],
                ['A written philosophy', 'Members choose coaches on how they think, not just what they are certified in.'],
                ['A response commitment', 'Every check-in answered within one working day.'],
              ].map(([title, body]) => (
                <li key={title} className="border-b border-ink-900/8 pb-4 last:border-0">
                  <p className="font-medium">{title}</p>
                  <p className="mt-1 text-sm text-muted">{body}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      <Section tone="light" size="md" id="apply">
        <div className="mx-auto max-w-2xl">
          <SectionHeading eyebrow="Apply" title="APPLY AS A COACH." align="center" />
          <div className="mt-10">
            <CoachApplication />
          </div>
        </div>
      </Section>
    </>
  );
}
