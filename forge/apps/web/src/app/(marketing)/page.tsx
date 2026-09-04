import Link from 'next/link';
import { Hero } from '@/components/marketing/hero';
import { AssessmentPreview } from '@/components/marketing/assessment-preview';
import { ProgramCard, WorkoutCard } from '@/components/marketing/cards';
import { Section, SectionHeading, Card, Media, Chip, ButtonLink } from '@/components/ui/primitives';
import { ProgressRing, ProgressBar } from '@/components/ui/charts';
import { apiPublic } from '@/lib/api';
import type { Program } from '@/lib/types';

// The catalogue is served by the API, which is not running during `next build`.
// Rendering on request keeps the build independent of a live backend; set
// `revalidate` instead once the API is reachable at build time.
export const dynamic = 'force-dynamic';

const SYSTEM = [
  {
    key: 'train',
    title: 'TRAIN',
    body: 'Personalised workouts and progressive training programmes that adapt to what you actually logged.',
    detail: '500+ workouts · 11 training styles',
    imageKey: 'system-train',
  },
  {
    key: 'fuel',
    title: 'FUEL',
    body: 'Nutrition targets calculated from your own physiology, with recipes and a weekly shopping list.',
    detail: 'Macro targets · Meal plans · Shopping list',
    imageKey: 'system-fuel',
  },
  {
    key: 'recover',
    title: 'RECOVER',
    body: 'Mobility, sleep, breathing and recovery protocols scheduled as work, not as an afterthought.',
    detail: 'Readiness scoring · Guided sessions',
    imageKey: 'system-recover',
  },
  {
    key: 'coach',
    title: 'COACH',
    body: 'Certified coaches who read your check-ins, review your form and adjust the plan around your week.',
    detail: 'Weekly check-ins · Form review · Video calls',
    imageKey: 'system-coach',
  },
];

const TIMELINE = [
  { time: '07:30', label: 'Morning mobility' },
  { time: '12:30', label: 'Lunch' },
  { time: '17:30', label: 'Strength Training' },
  { time: '19:00', label: 'Recovery Meal' },
  { time: '21:30', label: 'Breathwork' },
];

const DISCOVERY = [
  { title: 'Heavy Lower Body', style: 'Strength', minutes: 45, level: 'intermediate', coach: 'Daniel', format: 'COACHED' as const, imageKey: 'workout-lower' },
  { title: '20-Minute Conditioning', style: 'HIIT', minutes: 20, level: 'beginner', coach: 'Sofia', format: 'COACHED' as const, imageKey: 'workout-hiit' },
  { title: 'Threshold Intervals', style: 'Running', minutes: 40, level: 'advanced', coach: 'Amara', format: 'SELF-GUIDED' as const, imageKey: 'workout-run' },
  { title: 'Full Body Mobility', style: 'Mobility', minutes: 10, level: 'beginner', coach: 'Inés', format: 'COACHED' as const, imageKey: 'workout-mobility' },
];

export default async function HomePage() {
  const { programs } = await apiPublic<{ programs: Program[] }>('/v1/catalog/programs');

  return (
    <>
      <Hero />

      {/* ------------------------------------------------ personalisation */}
      <Section tone="light" size="lg">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-start lg:gap-20">
          <div className="lg:sticky lg:top-28">
            <p className="eyebrow mb-5">Personalisation</p>
            <h2 className="display text-display-md text-balance">
              NOT ANOTHER WORKOUT LIBRARY.
              <br />
              <span className="text-ember">YOUR PERSONAL PERFORMANCE SYSTEM.</span>
            </h2>
            <p className="mt-6 max-w-prose text-base leading-relaxed opacity-70">
              A library gives you a thousand workouts and no answer to the only question that matters: what
              should I do today? FORGE builds a twelve-week plan from your goal, your experience, your week and
              the equipment you actually own — then rewrites it every time you log a session.
            </p>

            <dl className="mt-10 grid gap-6 sm:grid-cols-2">
              {[
                ['Built from your answers', 'Ten questions produce a full roadmap, not a category filter.'],
                ['Adapts to what you log', 'Miss the rep target and next week comes down. Beat it and it goes up.'],
                ['Respects your equipment', 'No session ever asks for a bar you do not own.'],
                ['Recovery is scheduled', 'Readiness decides whether today is a push day or a hold day.'],
              ].map(([title, body]) => (
                <div key={title}>
                  <dt className="font-semibold">{title}</dt>
                  <dd className="mt-1.5 text-sm leading-relaxed opacity-65">{body}</dd>
                </div>
              ))}
            </dl>
          </div>

          <AssessmentPreview />
        </div>
      </Section>

      {/* ------------------------------------------------ the FORGE system */}
      <Section tone="dark" size="lg">
        <SectionHeading
          eyebrow="The FORGE system"
          title={<>FOUR PARTS.<br />ONE SYSTEM.</>}
          lead="Most products do one of these well and bolt the others on. In FORGE they share one plan, one set of data and one coach."
        />

        <div className="mt-14 grid gap-px overflow-hidden rounded-card border border-bone-200/10 bg-bone-200/10 sm:grid-cols-2 xl:grid-cols-4">
          {SYSTEM.map((item, index) => (
            <article key={item.key} className="group relative bg-ink-900 p-7 transition-colors duration-300 hover:bg-ink-800">
              <div className="mb-6 overflow-hidden rounded-[10px]">
                <Media imageKey={item.imageKey} ratio="3/2" rounded={false} alt={`${item.title} pillar`} />
              </div>
              <p className="eyebrow">0{index + 1}</p>
              <h3 className="display mt-2 text-3xl leading-none text-bone-100">{item.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-bone-200/70">{item.body}</p>
              <p className="mt-5 text-[0.6875rem] uppercase tracking-[0.1em] text-bone-200/45">{item.detail}</p>
            </article>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------ daily plan */}
      <Section tone="bone" size="lg">
        <SectionHeading
          eyebrow="Your day, decided"
          title={<>TODAY IS ALREADY<br />PLANNED.</>}
          lead="Open the app and the decision is made: what to train, what to eat, how hard to push and when to stop."
          action={<ButtonLink href="/app" variant="secondary">View Your Daily Plan</ButtonLink>}
        />

        <div className="mt-14 grid min-w-0 gap-6 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
          <Card tone="dark" padded={false}>
            <div className="border-b border-bone-200/10 p-6 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="eyebrow">Today</p>
                  <p className="display mt-2 text-display-sm text-bone-100">GOOD MORNING, ALEX.</p>
                  <p className="mt-2 text-sm text-bone-200/60">Monday, September 7 · Week 5 of 12</p>
                </div>
                <ProgressRing value={82} label="Readiness" sublabel="Ready" tone="good" />
              </div>
            </div>

            <div className="grid gap-px bg-bone-200/10 sm:grid-cols-2">
              <div className="bg-ink-800 p-6">
                <p className="eyebrow mb-3">Today&rsquo;s training</p>
                <p className="display text-2xl leading-none text-bone-100">UPPER BODY STRENGTH</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Chip tone="inverse" size="sm">45 min</Chip>
                  <Chip tone="inverse" size="sm">Intermediate</Chip>
                  <Chip tone="inverse" size="sm">Gym</Chip>
                </div>
                <p className="mt-4 text-sm text-bone-200/60">Coach: Maya · Push emphasis</p>
              </div>

              <div className="grid grid-cols-2 gap-px bg-bone-200/10">
                <MetricTile label="Nutrition" value="2,350" hint="kcal target" />
                <MetricTile label="Steps" value="7,420" hint="of 10,000" />
                <MetricTile label="Water" value="2.1L" hint="of 3.0L" />
                <MetricTile label="Recovery" value="10 min" hint="mobility" />
              </div>
            </div>

            <div className="p-6 sm:p-8">
              <p className="eyebrow mb-5">Your day</p>
              <ol className="scroll-x scrollbar-none flex gap-3 pb-1">
                {TIMELINE.map((entry, index) => (
                  <li key={entry.time} className="min-w-[132px] flex-1">
                    <div className="relative">
                      <div className="h-px w-full bg-bone-200/15" />
                      <span
                        aria-hidden
                        className={`absolute -top-1 left-0 h-2 w-2 rounded-full ${index === 2 ? 'bg-ember' : 'bg-bone-200/30'}`}
                      />
                    </div>
                    <p className="mt-3 text-xs font-semibold tabular-nums text-bone-100">{entry.time}</p>
                    <p className="mt-1 text-xs text-bone-200/55">{entry.label}</p>
                  </li>
                ))}
              </ol>
            </div>
          </Card>

          <div className="grid gap-6">
            <Card>
              <p className="eyebrow mb-4">This week</p>
              <div className="space-y-4">
                <ProgressBar value={4} max={5} label="Workouts" valueLabel="4 / 5" />
                <ProgressBar value={82} label="Weekly load" valueLabel="82%" tone="good" />
                <ProgressBar value={148} max={170} label="Protein today" valueLabel="148 / 170g" />
                <ProgressBar value={462} max={480} label="Sleep last night" valueLabel="7h 42m" tone="good" />
              </div>
              <div className="rule my-6" />
              <div className="flex items-center justify-between">
                <div>
                  <p className="eyebrow">Training streak</p>
                  <p className="display mt-1 text-2xl leading-none">18 days</p>
                </div>
                <ProgressRing value={86} size={64} sublabel="Rec" tone="good" />
              </div>
            </Card>

            <Card tone="dark">
              <p className="eyebrow mb-3">Coach check-in</p>
              <p className="text-sm leading-relaxed text-bone-200/75">
                &ldquo;Heavy and moving is exactly where week five should feel. Hold 100kg one more session, then
                we step to 102.5kg.&rdquo;
              </p>
              <p className="mt-4 text-xs text-bone-200/45">Maya Roberts · 6:00 PM today</p>
            </Card>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------ programmes */}
      <Section tone="light" size="lg">
        <SectionHeading
          eyebrow="Programmes"
          title="A PROGRAM FOR EVERY GOAL."
          lead="Twelve structured builds, each with a phase plan, a progression model and a coach behind it."
          action={<ButtonLink href="/programs" variant="ghost">Browse All Programs</ButtonLink>}
        />

        <div className="mt-14 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {programs.slice(0, 6).map((program) => (
            <ProgramCard key={program.slug} program={program} />
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------ discovery */}
      <Section tone="dark" size="lg">
        <SectionHeading
          eyebrow="Workout discovery"
          title={<>FILTER DOWN TO<br />THE ONE YOU&rsquo;LL DO.</>}
          lead="Eleven training styles, five to sixty minutes, coached or self-guided — filtered by the equipment on your profile so nothing you cannot run ever appears."
          action={<ButtonLink href="/training" variant="inverse">Explore Workouts</ButtonLink>}
        />

        <div className="mt-10 flex flex-wrap gap-2">
          {['Strength', 'HIIT', 'Running', 'Pilates', 'Yoga', 'Boxing', 'Mobility', 'Functional', 'Hybrid', 'Cardio', 'Recovery'].map(
            (style) => (
              <Link
                key={style}
                href={`/training?style=${style.toLowerCase()}`}
                className="min-h-[40px] rounded-pill border border-bone-200/20 px-4 text-xs font-medium leading-[38px] text-bone-200/70 transition-colors hover:border-bone-200/50 hover:text-bone-100"
              >
                {style}
              </Link>
            ),
          )}
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {DISCOVERY.map((workout) => (
            <WorkoutCard key={workout.title} {...workout} href="/training" />
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------ coaching CTA */}
      <Section tone="bone" size="lg">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <Media imageKey="coaching-session" ratio="4/3" alt="One-to-one coaching session" />
          <div>
            <p className="eyebrow mb-5">Online coaching</p>
            <h2 className="display text-display-md text-balance">
              REAL COACHES.
              <br />
              REAL ACCOUNTABILITY.
            </h2>
            <p className="mt-6 max-w-prose text-base leading-relaxed opacity-70">
              Work 1-to-1 with certified professionals who understand your goals. Weekly check-ins they actually
              read, form reviews with timestamped notes, and a plan that changes when your week does.
            </p>
            <ul className="mt-8 space-y-3">
              {[
                'Matched to your goal, budget, language and availability',
                'Video form review with notes pinned to the second',
                'A written response to every weekly check-in',
                'Monthly 1-to-1 video session',
              ].map((line) => (
                <li key={line} className="flex gap-3 text-sm">
                  <span aria-hidden className="text-ember">✓</span>
                  <span className="opacity-75">{line}</span>
                </li>
              ))}
            </ul>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/coaching" size="lg">Find My Coach</ButtonLink>
              <ButtonLink href="/for-coaches" variant="ghost" size="lg">Apply as a Coach</ButtonLink>
            </div>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------ closing */}
      <Section tone="dark" size="lg">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="display text-display-lg text-balance">
            NO GUESSING.
            <br />
            JUST PROGRESS.
          </h2>
          <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-bone-200/70">
            Start with the assessment. See your plan before you pay for anything.
          </p>
          <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
            <ButtonLink href="/assessment" size="lg">Start Your 7-Day Free Trial</ButtonLink>
            <ButtonLink href="/pricing" variant="inverse" size="lg">See Pricing</ButtonLink>
          </div>
          <p className="mt-6 text-xs text-bone-200/45">Cancel anytime. No hidden fees.</p>
        </div>
      </Section>
    </>
  );
}

function MetricTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-ink-800 p-5">
      <p className="eyebrow">{label}</p>
      <p className="display mt-2 text-xl leading-none text-bone-100 tabular-nums">{value}</p>
      <p className="mt-1 text-[0.6875rem] text-bone-200/45">{hint}</p>
    </div>
  );
}
