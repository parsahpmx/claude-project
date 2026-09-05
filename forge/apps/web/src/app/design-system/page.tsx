import Link from 'next/link';
import {
  Button, ButtonLink, Card, Chip, Media, Section, SectionHeading, Stat, Divider,
} from '@/components/ui/primitives';
import {
  Badge, EmptyState, ErrorState, SuccessState, Skeleton, SkeletonCard, Status,
} from '@/components/ui/feedback';
import {
  BarChart, DonutChart, Heatmap, LineChart, ProgressBar, ProgressRing, Sparkline,
} from '@/components/ui/charts';
import { addDays, consistencyHeatmap } from '@forge/core';
import { DesignSystemInteractive } from '@/components/marketing/design-system-interactive';

export const metadata = {
  title: 'Design System',
  description: 'The FORGE component library, tokens and states.',
};

const SWATCHES = [
  ['ink-900', '#0B0B0C', 'Primary surface, dark mode ground'],
  ['ink-800', '#121214', 'Raised dark surface'],
  ['ink-700', '#1A1A1D', 'Dark hover'],
  ['bone-100', '#FBFAF8', 'Card surface'],
  ['bone-200', '#F5F2ED', 'Page ground'],
  ['bone-300', '#E7E2DA', 'Section tint'],
  ['smoke-500', '#6E6E77', 'Secondary text'],
  ['ember-500', '#E8462B', 'The single accent'],
  ['signal-good', '#3FA96B', 'Success, on track'],
  ['signal-warn', '#D99A2B', 'Caution, behind pace'],
  ['signal-bad', '#D9453B', 'Error, missed'],
  ['signal-info', '#4A82C4', 'Neutral information'],
];

// The heatmap demo runs the same `consistencyHeatmap` the progress screen uses,
// over a synthetic twelve-week block. Building it through the real function —
// rather than hand-rolling cells — keeps this page a specification: if the
// production shape changes, the demo changes with it, and the dates are unique
// by construction because `eachDay` walks the range.
const HEATMAP_FROM = '2026-06-15';
const HEATMAP_TO = addDays(HEATMAP_FROM, 83);
const HEATMAP_CELLS = consistencyHeatmap(
  Array.from({ length: 84 }, (_, i) => ({ day: addDays(HEATMAP_FROM, i), index: i }))
    // Four sessions a week, with the occasional week where life got in the way.
    .filter(({ index }) => index % 7 < 4 && index % 19 !== 5)
    .map(({ day }) => ({
      date: day,
      durationMinutes: 58,
      volumeGrams: 12_400_000,
      calories: 470,
      kind: 'strength',
      muscleGroups: [],
    })),
  HEATMAP_FROM,
  HEATMAP_TO,
);

const SERIES = Array.from({ length: 12 }, (_, i) => ({
  date: `2026-0${Math.floor(i / 4) + 6}-${String((i % 4) * 7 + 1).padStart(2, '0')}`,
  value: 100 + i * 6 + (i % 3) * 9,
}));

export default function DesignSystemPage() {
  return (
    <div className="light-surface min-h-dvh bg-bone-200">
      <header className="dark-surface sticky top-0 z-40 border-b border-bone-200/10 bg-ink-900 text-bone-200">
        <div className="shell flex h-[72px] items-center justify-between">
          <Link href="/" className="display text-xl tracking-[0.08em] text-bone-100">FORGE</Link>
          <p className="text-xs uppercase tracking-[0.14em] text-muted">Design System</p>
        </div>
      </header>

      <main id="main">
        <Section tone="dark" size="md">
          <div className="max-w-3xl">
            <p className="eyebrow mb-5">Design system</p>
            <h1 className="display text-display-lg text-balance">ONE SYSTEM. FORTY SCREENS.</h1>
            <p className="mt-6 text-lg leading-relaxed text-bone-200/70">
              Every component here is a closed set of variants rather than a className passthrough. That is
              what keeps the fortieth screen looking like the first, and it is what makes this page a
              specification rather than a gallery.
            </p>
          </div>
        </Section>

        {/* ------------------------------------------------------ colour */}
        <Section tone="light" size="md">
          <SectionHeading
            eyebrow="Foundations"
            title="COLOUR"
            lead="A near-black, a warm off-white, four greys and exactly one accent. Status colours exist but are never the only carrier of meaning."
          />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {SWATCHES.map(([name, hex, usage]) => (
              <div key={name} className="light-surface rounded-card border border-ink-900/10 bg-bone-100 p-4">
                <div className="h-16 w-full rounded-[8px] border border-ink-900/10" style={{ background: hex }} />
                <p className="mt-3 font-mono text-xs">{name}</p>
                <p className="font-mono text-[0.6875rem] text-muted">{hex}</p>
                <p className="mt-1.5 text-xs text-muted">{usage}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* ------------------------------------------------- typography */}
        <Section tone="bone" size="md">
          <SectionHeading eyebrow="Foundations" title="TYPOGRAPHY" />
          <div className="mt-10 space-y-8">
            {[
              ['display-xl', 'BUILD YOUR STRONGEST SELF.', 'text-display-xl'],
              ['display-lg', 'TRAIN WITH PURPOSE.', 'text-display-lg'],
              ['display-md', 'A PROGRAM FOR EVERY GOAL.', 'text-display-md'],
              ['display-sm', 'YOUR ROADMAP', 'text-display-sm'],
            ].map(([token, sample, className]) => (
              <div key={token} className="border-b border-ink-900/8 pb-8 last:border-0">
                <p className="eyebrow mb-3">{token}</p>
                <p className={`display ${className}`}>{sample}</p>
              </div>
            ))}
            <div>
              <p className="eyebrow mb-3">body</p>
              <p className="max-w-prose text-base leading-relaxed">
                A complete performance system combining personalised training, nutrition, recovery and real
                coaching. Body copy is set at a comfortable measure — around 68 characters — because a line
                longer than that costs the reader their place on every return sweep.
              </p>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------- buttons */}
        <Section tone="light" size="md">
          <SectionHeading eyebrow="Components" title="BUTTONS & CHIPS" />
          <div className="mt-10 grid gap-8">
            <div>
              <p className="eyebrow mb-4">Variants</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger">Danger</Button>
                <Button variant="primary" disabled>Disabled</Button>
              </div>
            </div>
            <div>
              <p className="eyebrow mb-4">Sizes — all at least 40px tall, for touch</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm">Small</Button>
                <Button size="md">Medium</Button>
                <Button size="lg">Large</Button>
              </div>
            </div>
            <div>
              <p className="eyebrow mb-4">Chips</p>
              <div className="flex flex-wrap items-center gap-2">
                <Chip>Neutral</Chip>
                <Chip tone="accent">Accent</Chip>
                <Chip tone="good">Good</Chip>
                <Chip tone="warn">Warn</Chip>
                <Chip tone="bad">Bad</Chip>
                <Badge>Consistency 30</Badge>
                <Badge earned={false}>Not earned</Badge>
              </div>
            </div>
          </div>
        </Section>

        {/* ------------------------------------------------------ forms */}
        <Section tone="bone" size="md">
          <SectionHeading
            eyebrow="Components"
            title="FORMS"
            lead="Every control renders a real label bound by id. A placeholder is never a substitute for one."
          />
          <div className="mt-10">
            <DesignSystemInteractive />
          </div>
        </Section>

        {/* ----------------------------------------------------- charts */}
        <Section tone="light" size="md">
          <SectionHeading
            eyebrow="Components"
            title="CHARTS"
            lead="Hand-built SVG. Every chart is also readable as text — the numbers live in the labels, not only in the geometry."
          />
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <Card>
              <p className="eyebrow mb-5">Progress rings</p>
              <div className="flex flex-wrap gap-8">
                <ProgressRing value={82} label="Readiness" sublabel="Ready" tone="good" />
                <ProgressRing value={54} label="Adherence" sublabel="Week" tone="warn" />
                <ProgressRing value={32} label="Block" sublabel="Complete" />
              </div>
            </Card>
            <Card>
              <p className="eyebrow mb-5">Progress bars</p>
              <div className="space-y-4">
                <ProgressBar value={148} max={170} label="Protein" valueLabel="148 / 170g" />
                <ProgressBar value={4} max={5} label="Workouts" valueLabel="4 / 5" tone="good" />
                <ProgressBar value={2} max={7} label="Steps" valueLabel="Behind" tone="warn" />
              </div>
              <Divider />
              <p className="eyebrow mb-3">Sparkline</p>
              <Sparkline values={SERIES.map((s) => s.value)} />
            </Card>
            <Card>
              <p className="eyebrow mb-5">Line chart</p>
              <LineChart label="Estimated 1RM" points={SERIES} format={(v) => `${Math.round(v)} kg`} />
            </Card>
            <Card>
              <p className="eyebrow mb-5">Bar chart</p>
              <BarChart label="Weekly volume" points={SERIES} />
            </Card>
            <Card>
              <p className="eyebrow mb-5">Heatmap</p>
              <Heatmap
                label="Consistency"
                cells={HEATMAP_CELLS}
              />
            </Card>
            <Card>
              <p className="eyebrow mb-5">Donut chart</p>
              <DonutChart
                label="Muscle distribution"
                segments={[
                  { label: 'chest', value: 18, share: 26 },
                  { label: 'back', value: 16, share: 23 },
                  { label: 'quads', value: 14, share: 20 },
                  { label: 'glutes', value: 11, share: 16 },
                  { label: 'core', value: 10, share: 15 },
                ]}
              />
            </Card>
          </div>
        </Section>

        {/* ----------------------------------------------------- states */}
        <Section tone="bone" size="md">
          <SectionHeading
            eyebrow="Components"
            title="STATES"
            lead="Empty, loading, error and success are first-class components. A screen that has only ever been seen with good data is a screen that has not been designed."
          />
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <Card padded={false}>
              <div className="p-6">
                <EmptyState
                  icon="▤"
                  title="No active plan yet"
                  body="Pick a programme and FORGE builds the full block before you train once."
                  action={<ButtonLink href="/programs" size="sm">Browse Programs</ButtonLink>}
                />
              </div>
            </Card>
            <Card padded={false}>
              <div className="p-6">
                <ErrorState
                  title="We could not save that session"
                  body="Your sets are still on this device. Try again — nothing has been lost."
                  action={<Button size="sm">Try again</Button>}
                />
              </div>
            </Card>
            <Card padded={false}>
              <div className="p-6">
                <SuccessState
                  title="Profile updated"
                  body="Your plan re-checks every remaining session against these settings."
                />
              </div>
            </Card>
            <Card>
              <p className="eyebrow mb-5">Skeletons</p>
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-4/5" />
              <div className="mt-6"><SkeletonCard /></div>
            </Card>
          </div>

          <div className="mt-8">
            <Card>
              <p className="eyebrow mb-4">Status — never colour alone</p>
              <div className="flex flex-wrap gap-3">
                <Status status="completed" />
                <Status status="scheduled" />
                <Status status="skipped" />
                <Status status="connected" />
                <Status status="not-connected" />
                <Status status="syncing" />
                <Status status="pending" />
                <Status status="paid" />
              </div>
              <p className="mt-5 max-w-prose text-sm leading-relaxed text-muted">
                Every status carries a glyph and a word alongside its colour, so it survives greyscale printing,
                colour-blindness and a screen in direct sunlight.
              </p>
            </Card>
          </div>
        </Section>

        {/* ------------------------------------------------- surfaces */}
        <Section tone="light" size="md">
          <SectionHeading eyebrow="Components" title="SURFACES & MEDIA" />
          <div className="mt-10 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            <Card>
              <p className="eyebrow mb-3">Light card</p>
              <p className="text-sm text-muted">The default surface for content on the page ground.</p>
              <Divider />
              <Stat label="Total volume" value="128t" hint="Load × reps" />
            </Card>
            <Card tone="dark">
              <p className="eyebrow mb-3">Dark card</p>
              <p className="text-sm text-bone-200/70">Used for the one thing on a screen that matters most.</p>
              <Divider />
              <Stat label="Readiness" value="82" hint="Ready" tone="dark" />
            </Card>
            <Card padded={false}>
              <Media imageKey="design-system-sample" ratio="4/3" rounded={false} alt="Generated media surface" />
              <div className="p-5">
                <p className="eyebrow mb-2">Generated media</p>
                <p className="text-sm text-muted">
                  Deterministic from the image key. The same key always renders the same composition.
                </p>
              </div>
            </Card>
          </div>
        </Section>

        {/* ------------------------------------------------ accessibility */}
        <Section tone="dark" size="md">
          <SectionHeading
            eyebrow="Principles"
            title="ACCESSIBILITY IS A CONSTRAINT, NOT A PASS"
          />
          <div className="mt-10 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {[
              ['Contrast', 'Body text meets WCAG AA against every surface it is used on. The accent is never used for small text on a light ground.'],
              ['Focus', 'One focus ring, one shape, everywhere. A keyboard user never has to guess where they are.'],
              ['Touch targets', 'Every interactive element is at least 40px tall, and the primary ones are 48–56px.'],
              ['Never colour alone', 'Status carries a glyph and a word. Charts label their values as text.'],
              ['Motion', 'Every animation is decoration and every one is disabled under prefers-reduced-motion.'],
              ['Captions', 'Workout and recovery videos ship with captions. It is marked on the card, not buried in a player.'],
            ].map(([title, body]) => (
              <div key={title}>
                <div className="mb-4 h-px w-12 bg-ember" />
                <h3 className="font-semibold text-bone-100">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-bone-200/65">{body}</p>
              </div>
            ))}
          </div>
        </Section>
      </main>
    </div>
  );
}
