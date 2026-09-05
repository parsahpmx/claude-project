import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ApiRequestError, apiPublic } from '@/lib/api';
import { Section, SectionHeading, Card, Media, Chip, ButtonLink, Stat } from '@/components/ui/primitives';
import { ProgramCard } from '@/components/marketing/cards';
import { formatCents, formatRating, formatNumber } from '@/lib/format';
import type { Program } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface CoachDetail {
  coach: {
    id: string; slug: string; headline: string; bio: string; philosophy: string;
    specialties: string[]; languages: string[]; certifications: string[];
    yearsExperience: number; ratingTenths: number; reviewCount: number; clientCount: number;
    availableSlotsThisWeek: number; acceptingClients: boolean;
    monthlyPriceCents: number; consultationPriceCents: number; sessionPriceCents: number;
    imageKey: string; firstName: string; lastName: string;
  };
  reviews: { rating: number; body: string; firstName: string; createdAt: string }[];
  programs: Program[];
  stories: {
    slug: string; memberName: string; headline: string; timePeriod: string;
    consistency: string; outcomes: string[]; imageKey: string;
  }[];
}

/** Availability is illustrative in the prototype; bookings are real. */
const SLOTS = ['Mon 07:00', 'Mon 18:00', 'Tue 12:30', 'Wed 07:00', 'Thu 18:00', 'Thu 19:30', 'Fri 08:00', 'Sat 09:00'];

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { coach } = await apiPublic<CoachDetail>(`/v1/catalog/coaches/${slug}`);
    return {
      title: `${coach.firstName} ${coach.lastName}`,
      description: coach.headline,
    };
  } catch {
    // The page renders the 404; metadata must not throw a second time.
    return { title: 'Coach' };
  }
}

export default async function CoachProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let detail: CoachDetail;
  try {
    detail = await apiPublic<CoachDetail>(`/v1/catalog/coaches/${slug}`);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    throw error;
  }

  const { coach, reviews, programs, stories } = detail;

  return (
    <>
      <Section tone="dark" size="lg">
        <div className="pt-16">
          <Link href="/coaching" className="text-xs uppercase tracking-[0.14em] text-bone-200/55 hover:text-bone-100">
            ← All coaches
          </Link>

          <div className="mt-8 grid gap-10 lg:grid-cols-[320px_1fr] lg:gap-16">
            <Media imageKey={coach.imageKey} ratio="3/4" alt={`${coach.firstName} ${coach.lastName}`} />

            <div>
              <h1 className="display text-display-lg leading-[0.9]">
                {coach.firstName}
                <br />
                {coach.lastName}
              </h1>
              <p className="mt-4 text-lg text-bone-200/75">{coach.headline}</p>

              <div className="mt-7 flex flex-wrap items-center gap-x-8 gap-y-4">
                <Stat label="Rating" value={<span><span aria-hidden className="text-accent">★</span> {formatRating(coach.ratingTenths)}</span>} hint={`${coach.reviewCount} reviews`} tone="dark" />
                <Stat label="Clients" value={coach.clientCount} hint="coached to date" tone="dark" />
                <Stat label="Experience" value={`${coach.yearsExperience}y`} hint="coaching" tone="dark" />
                <Stat
                  label="Availability"
                  value={coach.availableSlotsThisWeek > 0 ? `${coach.availableSlotsThisWeek} slots` : 'Waitlist'}
                  hint="this week"
                  tone="dark"
                />
              </div>

              <div className="mt-7 flex flex-wrap gap-2">
                {coach.specialties.map((specialty) => (
                  <Chip key={specialty} tone="inverse">{specialty.replace(/-/g, ' ')}</Chip>
                ))}
              </div>

              <div className="mt-9 flex flex-wrap gap-3">
                <ButtonLink href={`/signup?coach=${coach.slug}`} size="lg">Choose As My Coach</ButtonLink>
                <ButtonLink href={`/signup?coach=${coach.slug}&booking=consultation`} variant="inverse" size="lg">
                  Book Free Consultation
                </ButtonLink>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section tone="light" size="md">
        <div className="grid gap-12 lg:grid-cols-[1.5fr_1fr] lg:gap-20">
          <div className="space-y-12">
            <div>
              <p className="eyebrow mb-4">About</p>
              <p className="max-w-prose text-lg leading-relaxed">{coach.bio}</p>
            </div>

            <div>
              <p className="eyebrow mb-4">Coaching philosophy</p>
              <blockquote className="border-l-2 border-ember pl-6">
                <p className="max-w-prose text-lg italic leading-relaxed opacity-85">{coach.philosophy}</p>
              </blockquote>
            </div>

            <div>
              <p className="eyebrow mb-4">Certifications</p>
              <ul className="grid gap-3 sm:grid-cols-2">
                {coach.certifications.map((certification) => (
                  <li key={certification} className="light-surface flex items-center gap-3 rounded-[8px] border border-ink-900/10 bg-bone-100 px-4 py-3 text-sm">
                    <span aria-hidden className="text-accent">✓</span>
                    {certification}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="eyebrow mb-4">Languages</p>
              <div className="flex flex-wrap gap-2">
                {coach.languages.map((language) => <Chip key={language}>{language}</Chip>)}
              </div>
            </div>
          </div>

          <div className="space-y-6 lg:sticky lg:top-28 lg:self-start">
            <Card>
              <p className="eyebrow mb-5">Pricing</p>
              <ul className="space-y-4">
                <PriceRow
                  label="30-minute consultation"
                  price={coach.consultationPriceCents === 0 ? 'Free' : formatCents(coach.consultationPriceCents)}
                  note="No commitment"
                />
                <PriceRow label="60-minute session" price={formatCents(coach.sessionPriceCents)} note="One-off" />
                <PriceRow
                  label="Monthly coaching"
                  price={`${formatCents(coach.monthlyPriceCents)}/mo`}
                  note="Everything included"
                  highlight
                />
              </ul>
              <div className="mt-6">
                <ButtonLink href={`/signup?coach=${coach.slug}`} block size="lg">Book Session</ButtonLink>
              </div>
              <p className="mt-3 text-center text-xs text-muted">Cancel or change coach at any time.</p>
            </Card>

            <Card>
              <p className="eyebrow mb-4">Availability this week</p>
              {coach.availableSlotsThisWeek > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {SLOTS.slice(0, Math.max(2, coach.availableSlotsThisWeek * 2)).map((slot, index) => (
                    <span
                      key={slot}
                      className={`rounded-[6px] border px-3 py-2.5 text-center text-xs ${
                        index < coach.availableSlotsThisWeek
                          ? 'border-signal-good/30 bg-signal-good/10 text-status-good'
                          : 'border-ink-900/10 text-muted line-through'
                      }`}
                    >
                      {slot}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">
                  Fully booked this week. Join the waitlist and you will be offered the next opening —
                  typically within a fortnight.
                </p>
              )}
            </Card>
          </div>
        </div>
      </Section>

      {stories.length > 0 && (
        <Section tone="bone" size="md">
          <SectionHeading eyebrow="Client stories" title="WHAT THEY BUILT TOGETHER." />
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {stories.map((story) => (
              <Card key={story.slug}>
                <div className="mb-5 overflow-hidden rounded-[10px]">
                  <Media imageKey={story.imageKey} ratio="16/9" rounded={false} alt={story.headline} />
                </div>
                <p className="eyebrow">{story.memberName} · {story.timePeriod}</p>
                <h3 className="mt-2 text-lg font-semibold leading-snug">{story.headline}</h3>
                <ul className="mt-4 space-y-2">
                  {story.outcomes.map((outcome) => (
                    <li key={outcome} className="flex gap-3 text-sm">
                      <span aria-hidden className="text-accent">→</span>
                      <span className="text-muted">{outcome}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-muted">{story.consistency}</p>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {reviews.length > 0 && (
        <Section tone="light" size="md">
          <SectionHeading eyebrow="Reviews" title={`${formatNumber(coach.reviewCount)} MEMBER REVIEWS.`} />
          <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {reviews.map((review, index) => (
              <Card key={index}>
                <p aria-label={`${review.rating} out of 5`} className="text-accent">
                  {'★'.repeat(review.rating)}
                  <span className="opacity-25">{'★'.repeat(5 - review.rating)}</span>
                </p>
                <p className="mt-4 text-sm leading-relaxed opacity-80">&ldquo;{review.body}&rdquo;</p>
                <p className="mt-5 text-xs text-muted">{review.firstName}</p>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {programs.length > 0 && (
        <Section tone="bone" size="md">
          <SectionHeading eyebrow="Programmes" title={`PROGRAMS BY ${coach.firstName.toUpperCase()}.`} />
          <div className="mt-10 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {programs.map((program) => <ProgramCard key={program.slug} program={program} />)}
          </div>
        </Section>
      )}
    </>
  );
}

function PriceRow({
  label, price, note, highlight,
}: { label: string; price: string; note: string; highlight?: boolean }) {
  return (
    <li className={`flex items-start justify-between gap-4 rounded-[8px] px-4 py-3.5 ${highlight ? 'accent-tint bg-ember/[0.07] ring-1 ring-ember/20' : 'bg-ink-900/[0.03]'}`}>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted">{note}</p>
      </div>
      <p className="shrink-0 font-semibold tabular-nums">{price}</p>
    </li>
  );
}
