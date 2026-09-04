import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Section, SectionHeading, Card, Media, Chip, ButtonLink, Stat } from '@/components/ui/primitives';
import { ProgramCard } from '@/components/marketing/cards';
import { apiPublic } from '@/lib/api';
import { ApiRequestError } from '@/lib/api';
import { formatMinutes, formatRating, formatNumber } from '@/lib/format';
import { generateImage } from '@/lib/imagery';
import type { Program } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface ProgramDetail {
  program: Program;
  coach: {
    slug: string; headline: string; imageKey: string; ratingTenths: number;
    firstName: string; lastName: string; yearsExperience: number;
  } | null;
  reviews: { rating: number; body: string; firstName: string; createdAt: string }[];
  related: Program[];
}

const FAQ = [
  {
    q: 'What if I miss a session?',
    a: 'Nothing breaks. Reschedule it inside the week, or skip it — the plan tracks what you actually did and the next week is built from that, not from what it hoped you would do.',
  },
  {
    q: 'Can I run this with less equipment than listed?',
    a: 'Every movement has substitutes that train the same pattern. If a substitute exists for your setup, the workout player offers it; if none does, FORGE tells you rather than quietly swapping in something unrelated.',
  },
  {
    q: 'What happens after the final week?',
    a: 'You get a progress report comparing your starting and current numbers, your consistency and your personal records — and a recommendation for the next block based on what actually moved.',
  },
  {
    q: 'Do I need a coach for this?',
    a: 'No. Every programme runs self-guided with FORGE AI as an assistant. A human coach adds weekly check-ins, form review and plan adjustments — it is an upgrade, not a requirement.',
  },
];

export default async function ProgramDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let detail: ProgramDetail;
  try {
    detail = await apiPublic<ProgramDetail>(`/v1/catalog/programs/${slug}`);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    throw error;
  }

  const { program, coach, reviews, related } = detail;
  const weeklySchedule = program.template;

  return (
    <>
      {/* hero */}
      <section className="dark-surface relative isolate flex min-h-[70svh] items-end overflow-hidden bg-ink-900 pb-16 pt-32 text-bone-200">
        <div
          aria-hidden
          className="grain absolute inset-0 -z-10"
          style={{ background: generateImage(program.accentImage).background }}
        />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-ink-900 via-ink-900/80 to-ink-900/40" />

        <div className="shell relative">
          <Link href="/programs" className="text-xs uppercase tracking-[0.14em] text-bone-200/55 hover:text-bone-100">
            ← All programmes
          </Link>
          <h1 className="display mt-6 max-w-4xl text-display-lg text-balance">{program.name}</h1>
          <p className="mt-5 max-w-2xl text-lg text-bone-200/75">{program.tagline}</p>

          <div className="mt-8 flex flex-wrap gap-2">
            <Chip tone="inverse">{program.weeks} weeks</Chip>
            <Chip tone="inverse">{capitalise(program.difficulty)}</Chip>
            <Chip tone="inverse">{program.sessionsPerWeek} days / week</Chip>
            <Chip tone="inverse">{capitalise(program.location)}</Chip>
            <Chip tone="inverse">★ {program.rating.toFixed(1)} ({formatNumber(program.reviewCount)})</Chip>
          </div>

          <div className="mt-9 flex flex-wrap gap-3">
            <ButtonLink href={`/assessment?program=${program.slug}`} size="lg">Start Program</ButtonLink>
            <ButtonLink href="/pricing" variant="inverse" size="lg">See Pricing</ButtonLink>
          </div>
        </div>
      </section>

      {/* overview */}
      <Section tone="light" size="md">
        <div className="grid gap-12 lg:grid-cols-[1.5fr_1fr] lg:gap-20">
          <div>
            <p className="eyebrow mb-4">Overview</p>
            <p className="max-w-prose text-lg leading-relaxed">{program.summary}</p>

            <div className="mt-12">
              <p className="eyebrow mb-5">Expected outcomes</p>
              <ul className="space-y-4">
                {program.outcomes.map((outcome) => (
                  <li key={outcome} className="flex gap-4 border-b border-ink-900/8 pb-4 text-base">
                    <span aria-hidden className="mt-1 text-ember">→</span>
                    <span className="opacity-80">{outcome}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-12">
              <p className="eyebrow mb-5">Who it&rsquo;s for</p>
              <ul className="space-y-3">
                {program.whoItIsFor.map((line) => (
                  <li key={line} className="flex gap-3 text-sm">
                    <span aria-hidden className="text-ember">✓</span>
                    <span className="opacity-75">{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="space-y-6">
            <Card>
              <p className="eyebrow mb-5">At a glance</p>
              <dl className="grid grid-cols-2 gap-5">
                <Stat label="Duration" value={`${program.weeks}w`} />
                <Stat label="Per week" value={program.sessionsPerWeek} />
                <Stat label="Session" value={formatMinutes(program.sessionMinutes)} />
                <Stat label="Members" value={`${Math.round(program.memberCount / 1000)}k`} />
              </dl>
              <div className="rule my-6" />
              <p className="eyebrow mb-3">Progression model</p>
              <p className="text-sm capitalize opacity-75">{program.progression.replace(/-/g, ' ')}</p>
            </Card>

            <Card>
              <p className="eyebrow mb-4">Required equipment</p>
              <ul className="flex flex-wrap gap-2">
                {program.equipment.map((item) => (
                  <li key={item}><Chip>{item.replace(/-/g, ' ')}</Chip></li>
                ))}
              </ul>
              <p className="mt-4 text-xs leading-relaxed opacity-55">
                Missing something? Most movements have substitutes — FORGE checks your setup before the first
                session and tells you exactly what it swapped.
              </p>
            </Card>

            {coach && (
              <Card>
                <p className="eyebrow mb-4">Your coach</p>
                <Link href={`/coaching/${coach.slug}`} className="group flex gap-4">
                  <div className="w-20 shrink-0">
                    <Media imageKey={coach.imageKey} ratio="3/4" alt={`${coach.firstName} ${coach.lastName}`} />
                  </div>
                  <div>
                    <p className="display text-lg leading-none">{coach.firstName} {coach.lastName}</p>
                    <p className="mt-1.5 text-xs opacity-60">{coach.headline}</p>
                    <p className="mt-2 text-xs">
                      <span aria-hidden className="text-ember">★</span> {formatRating(coach.ratingTenths)} ·{' '}
                      {coach.yearsExperience} years
                    </p>
                  </div>
                </Link>
              </Card>
            )}
          </div>
        </div>
      </Section>

      {/* weekly schedule */}
      <Section tone="bone" size="md">
        <SectionHeading eyebrow="Weekly schedule" title="A TYPICAL WEEK." />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {weeklySchedule.map((session) => (
            <Card key={`${session.day}-${session.name}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">Day {session.day}</p>
                  <h3 className="mt-2 font-semibold leading-snug">{session.name}</h3>
                </div>
                <Chip size="sm" tone={session.kind === 'strength' ? 'accent' : 'neutral'}>
                  {session.kind}
                </Chip>
              </div>
              <p className="mt-3 text-xs opacity-60">{session.focus} · {formatMinutes(session.minutes)}</p>
              <ul className="mt-4 flex flex-wrap gap-1.5">
                {session.patterns.map((pattern) => (
                  <li key={pattern}>
                    <span className="rounded-[4px] bg-ink-900/[0.05] px-2 py-1 text-[0.625rem] uppercase tracking-[0.08em] opacity-70">
                      {pattern.replace(/-/g, ' ')}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </Section>

      {/* reviews */}
      {reviews.length > 0 && (
        <Section tone="light" size="md">
          <SectionHeading eyebrow="Community reviews" title="WHAT MEMBERS SAY." />
          <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {reviews.map((review, index) => (
              <Card key={index}>
                <p aria-label={`${review.rating} out of 5`} className="text-ember">
                  {'★'.repeat(review.rating)}
                  <span className="opacity-25">{'★'.repeat(5 - review.rating)}</span>
                </p>
                <p className="mt-4 text-sm leading-relaxed opacity-80">&ldquo;{review.body}&rdquo;</p>
                <p className="mt-5 text-xs opacity-50">{review.firstName}</p>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {/* FAQ */}
      <Section tone="bone" size="md">
        <SectionHeading eyebrow="Questions" title="BEFORE YOU START." />
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          {FAQ.map((entry) => (
            <details key={entry.q} className="group rounded-card border border-ink-900/10 bg-bone-100 p-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {entry.q}
                <span aria-hidden className="text-lg opacity-40 transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-4 text-sm leading-relaxed opacity-70">{entry.a}</p>
            </details>
          ))}
        </div>
      </Section>

      {related.length > 0 && (
        <Section tone="light" size="md">
          <SectionHeading eyebrow="Related" title="OTHER PROGRAMS FOR THIS GOAL." />
          <div className="mt-10 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {related.map((item) => (
              <ProgramCard key={item.slug} program={item} />
            ))}
          </div>
        </Section>
      )}

      <Section tone="dark" size="md">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="display text-display-md">START {program.name.toUpperCase()}.</h2>
          <p className="mt-5 text-bone-200/70">
            Take the assessment first — it takes two minutes and confirms this is the right block for you.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <ButtonLink href={`/assessment?program=${program.slug}`} size="lg">Start Program</ButtonLink>
            <ButtonLink href="/coaching" variant="inverse" size="lg">Add a Coach</ButtonLink>
          </div>
        </div>
      </Section>
    </>
  );
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
