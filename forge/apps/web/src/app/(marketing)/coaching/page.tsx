import { Section, SectionHeading, Card, ButtonLink, Media, Chip } from '@/components/ui/primitives';
import { CoachMarketplace } from '@/components/marketing/coach-marketplace';
import { apiPublic } from '@/lib/api';
import type { CoachCard } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Online Coaching',
  description: 'Work 1-to-1 with certified professionals who understand your goals.',
};

const HOW = [
  { step: '01', title: 'Tell us your goal', body: 'The marketplace ranks coaches against your goal, budget, language and availability — and shows you why each one ranked where it did.' },
  { step: '02', title: 'Book a free consultation', body: 'Thirty minutes, no charge, no commitment. Talk through your history and what has not worked before.' },
  { step: '03', title: 'Get a plan written for you', body: 'Not a generated block with your name on it. Your coach writes it, and rewrites it when your week changes.' },
  { step: '04', title: 'Check in every week', body: 'Nine questions on a Monday. A written response from a human who read all nine.' },
];

const INCLUDED = [
  ['Weekly check-ins', 'Energy, sleep, stress, adherence, weight, pain notes and your questions — answered in writing.'],
  ['Form review', 'Send a clip; get notes pinned to the exact second where the position breaks down.'],
  ['Direct messaging', 'Text, voice notes and video. Same-day responses on weekdays.'],
  ['Monthly video session', 'Sixty minutes to review the block, retest and set the next targets.'],
  ['Shared training plan', 'Your coach edits the same plan you run. No PDF, no version drift.'],
  ['Shared nutrition plan', 'Targets and meals your coach can adjust when your training load changes.'],
];

export default async function CoachingPage() {
  const { coaches } = await apiPublic<{ coaches: CoachCard[] }>('/v1/catalog/coaches');

  return (
    <>
      <Section tone="dark" size="lg">
        <div className="grid gap-12 pt-16 lg:grid-cols-[1.3fr_1fr] lg:items-center">
          <div>
            <p className="eyebrow mb-6">Online coaching</p>
            <h1 className="display text-display-lg text-balance">
              REAL COACHES.
              <br />
              REAL ACCOUNTABILITY.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-bone-200/70">
              Work 1-to-1 with certified professionals who understand your goals. Every coach on FORGE holds a
              recognised qualification, carries insurance and is capped at forty clients — because a coach with
              a hundred clients is coaching none of them.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="#marketplace" size="lg">Find My Coach</ButtonLink>
              <ButtonLink href="/pricing" variant="inverse" size="lg">See Pricing</ButtonLink>
            </div>
          </div>
          <Media imageKey="coaching-hero" ratio="3/4" alt="Coach reviewing a client's training week" />
        </div>
      </Section>

      <Section tone="light" size="md">
        <SectionHeading eyebrow="How it works" title="FOUR STEPS TO A COACH WHO KNOWS YOUR NUMBERS." />
        <div className="mt-12 grid gap-px overflow-hidden rounded-card border border-ink-900/10 bg-ink-900/10 sm:grid-cols-2 xl:grid-cols-4">
          {HOW.map((item) => (
            <div key={item.step} className="bg-bone-100 p-7">
              <p className="display text-3xl leading-none text-ember">{item.step}</p>
              <h3 className="mt-4 font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed opacity-65">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="bone" size="md" id="marketplace">
        <SectionHeading
          eyebrow="The marketplace"
          title="FIND YOUR COACH."
          lead="Filter by goal and the ranking explains itself — every card shows the reasons it appeared where it did."
        />
        <div className="mt-12">
          <CoachMarketplace coaches={coaches} />
        </div>
      </Section>

      <Section tone="dark" size="md">
        <SectionHeading eyebrow="What's included" title="EVERY COACHING PLAN INCLUDES." />
        <div className="mt-12 grid gap-8 sm:grid-cols-2 xl:grid-cols-3">
          {INCLUDED.map(([title, body]) => (
            <div key={title}>
              <div className="mb-4 h-px w-12 bg-ember" />
              <h3 className="font-semibold text-bone-100">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-bone-200/65">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="light" size="md">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <Card>
            <p className="eyebrow mb-4">Weekly check-in</p>
            <p className="display text-display-sm">NINE QUESTIONS.<br />ONE HUMAN ANSWER.</p>
            <ul className="mt-7 space-y-2.5 text-sm">
              {['Energy', 'Sleep quality', 'Stress', 'Nutrition adherence', 'Training adherence', 'Weight', 'Progress photos', 'Pain or injury notes', 'Questions for your coach'].map(
                (item, index) => (
                  <li key={item} className="flex items-center gap-3 border-b border-ink-900/8 pb-2.5">
                    <span className="w-5 text-xs tabular-nums opacity-40">{String(index + 1).padStart(2, '0')}</span>
                    <span className="opacity-80">{item}</span>
                  </li>
                ),
              )}
            </ul>
          </Card>
          <div>
            <h2 className="display text-display-md text-balance">
              THE CHECK-IN IS THE PRODUCT.
            </h2>
            <p className="mt-6 max-w-prose leading-relaxed opacity-70">
              Everything else can be automated. What cannot is somebody reading that you slept badly for four
              nights, that your knee is complaining, and that your week fell apart on Wednesday — and changing
              the plan accordingly before you decide the plan is the problem.
            </p>
            <p className="mt-5 max-w-prose leading-relaxed opacity-70">
              FORGE scores every check-in and flags what needs attention, so your coach opens with the thing
              that matters rather than scrolling for it. Pain notes go to the top, every time.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              <Chip tone="accent">Pain notes surface first</Chip>
              <Chip>Adherence tracked automatically</Chip>
              <Chip>Response within one working day</Chip>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
