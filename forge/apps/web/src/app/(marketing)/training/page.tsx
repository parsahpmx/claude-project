import { Section, SectionHeading, ButtonLink } from '@/components/ui/primitives';
import { WorkoutDiscovery } from '@/components/marketing/workout-discovery';

export const metadata = {
  title: 'Training',
  description: 'Eleven training styles, five to sixty minutes, coached or self-guided.',
};

export default function TrainingPage() {
  return (
    <>
      <Section tone="dark" size="lg">
        <div className="max-w-4xl pt-16">
          <p className="eyebrow mb-6">Workout discovery</p>
          <h1 className="display text-display-lg text-balance">TRAIN WITH PURPOSE.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-bone-200/70">
            Eleven training styles, five to sixty minutes, coached or self-guided. Filter by the equipment on
            your profile and nothing you cannot run will ever appear.
          </p>
          <div className="mt-9">
            <ButtonLink href="/assessment" size="lg">Get My Plan</ButtonLink>
          </div>
        </div>
      </Section>

      <Section tone="light" size="md">
        <WorkoutDiscovery />
      </Section>

      <Section tone="bone" size="md">
        <SectionHeading
          eyebrow="Inside the player"
          title="EVERYTHING YOU NEED, NOTHING YOU DON'T."
          lead="Full-screen video, the number to hit, what you lifted last time, and a rest timer that starts itself."
        />
        <div className="mt-12 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['Your previous numbers', 'Every set shows what you actually lifted last time — read from your history, not from the plan.'],
            ['Rest timer', 'Starts when you log a set, because the rest period is part of the prescription.'],
            ['Substitute mid-session', 'Machine taken? Swap to something that trains the same pattern with the kit you have.'],
            ['Coach tips', 'The cue that matters for this movement, on the screen where you need it.'],
          ].map(([title, body]) => (
            <div key={title}>
              <div className="mb-4 h-px w-12 bg-ember" />
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
