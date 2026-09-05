import Link from 'next/link';
import { Section, SectionHeading, Card, Media, ButtonLink } from '@/components/ui/primitives';
import { apiPublic } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Success Stories',
  description: 'What members actually built, over how long, with what consistency.',
};

interface Story {
  slug: string; memberName: string; headline: string; startingGoal: string;
  programSlug: string; programName: string; timePeriod: string; consistency: string;
  coachSlug: string | null; story: string; outcomes: string[]; imageKey: string;
}

export default async function StoriesPage() {
  const { stories } = await apiPublic<{ stories: Story[] }>('/v1/catalog/stories');

  return (
    <>
      <Section tone="dark" size="lg">
        <div className="max-w-4xl pt-16">
          <p className="eyebrow mb-6">Success stories</p>
          <h1 className="display text-display-lg text-balance">WHAT PROGRESS ACTUALLY LOOKS LIKE.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-bone-200/70">
            Real timeframes, real adherence numbers, and outcomes stated as what somebody can now do. No
            before-and-after photos, no twelve-week transformations that took two years.
          </p>
        </div>
      </Section>

      <Section tone="light" size="md">
        <div className="space-y-8">
          {stories.map((story, index) => (
            <Card key={story.slug} padded={false}>
              <div className={`grid gap-0 lg:grid-cols-2 ${index % 2 === 1 ? 'lg:[&>*:first-child]:order-2' : ''}`}>
                <Media imageKey={story.imageKey} ratio="4/3" rounded={false} alt={story.headline} />
                <div className="p-7 sm:p-10">
                  <p className="eyebrow">{story.memberName} · {story.timePeriod}</p>
                  <h2 className="display mt-3 text-display-sm text-balance">{story.headline}</h2>

                  <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                    <Detail label="Starting goal" value={story.startingGoal} />
                    <Detail label="Programme" value={story.programName} />
                    <Detail label="Time period" value={story.timePeriod} />
                    <Detail label="Consistency" value={story.consistency} />
                  </dl>

                  <blockquote className="mt-6 border-l-2 border-ember pl-5">
                    <p className="text-sm italic leading-relaxed opacity-80">&ldquo;{story.story}&rdquo;</p>
                  </blockquote>

                  <ul className="mt-6 space-y-2">
                    {story.outcomes.map((outcome) => (
                      <li key={outcome} className="flex gap-3 text-sm">
                        <span aria-hidden className="text-accent">→</span>
                        <span className="text-muted">{outcome}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-7 flex flex-wrap gap-3">
                    <Link
                      href={`/programs/${story.programSlug}`}
                      className="text-xs font-semibold uppercase tracking-[0.1em] text-accent"
                    >
                      View {story.programName} →
                    </Link>
                    {story.coachSlug && (
                      <Link
                        href={`/coaching/${story.coachSlug}`}
                        className="text-xs font-semibold uppercase tracking-[0.1em] text-muted hover:opacity-100"
                      >
                        Meet their coach →
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section tone="dark" size="md">
        <div className="mx-auto max-w-3xl text-center">
          <SectionHeading eyebrow="Your turn" title="BUILT AROUND YOU." align="center" />
          <div className="mt-8 flex justify-center">
            <ButtonLink href="/assessment" size="lg">Take the Assessment</ButtonLink>
          </div>
        </div>
      </Section>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.625rem] uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  );
}
