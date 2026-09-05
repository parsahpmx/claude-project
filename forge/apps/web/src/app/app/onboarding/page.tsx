import { redirect } from 'next/navigation';
import { AppSection, PageHeader } from '@/components/app/page-header';
import { StartProgramNotice } from '@/components/app/start-program-notice';
import { Card, ButtonLink } from '@/components/ui/primitives';

export const metadata = { title: 'Get started' };

export const dynamic = 'force-dynamic';

/**
 * Post-signup onboarding.
 *
 * A new member arrives here from checkout with their recommended programme in
 * the query string. The only job of this screen is to turn that recommendation
 * into a real plan, so the first thing they see in the app is a session.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const program = typeof params.program === 'string' ? params.program : null;
  if (!program) redirect('/app');

  return (
    <AppSection>
      <PageHeader
        eyebrow="Welcome to FORGE"
        title="LET'S BUILD YOUR PLAN."
        lead={`We recommended ${program.replace(/-/g, ' ')} from your assessment. Starting it schedules the full block — every week, every session, every starting load.`}
      />

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <StartProgramNotice />

        <Card tone="dark">
          <p className="eyebrow mb-4">What happens next</p>
          <ol className="space-y-4">
            {[
              ['Your plan is built', 'The whole block is scheduled at once, so you always know what is coming.'],
              ['Your first session', 'Conservative starting loads. Week one is about establishing a baseline, not proving anything.'],
              ['It adapts', 'Every logged set changes what comes next. By week three the plan is yours, not a template.'],
            ].map(([title, body], index) => (
              <li key={title} className="flex gap-4">
                <span aria-hidden className="display text-lg leading-none text-accent">0{index + 1}</span>
                <div>
                  <p className="font-medium text-bone-100">{title}</p>
                  <p className="mt-1 text-sm text-bone-200/60">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-7">
            <ButtonLink href="/app" variant="inverse" size="sm" block>Skip for now</ButtonLink>
          </div>
        </Card>
      </div>
    </AppSection>
  );
}
