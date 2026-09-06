import { ButtonLink, Card, Badge } from '@/components/ui/primitives';

export const metadata = {
  title: 'Pricing',
  description: 'FORGE is free during the open beta. Here is what that means and what happens afterwards.',
};

export default function PricingPage() {
  return (
    <section className="shell py-16">
      <p className="eyebrow">Pricing</p>
      <h1 className="mt-4 max-w-3xl text-display font-display text-bone-100 text-balance">
        Free while we are in beta
      </h1>
      <p className="mt-5 max-w-prose text-body muted">
        No card, no trial countdown, no feature held back to make a point. In exchange we
        ask for the occasional piece of feedback when something is wrong.
      </p>

      <div className="mt-12 grid gap-5 lg:grid-cols-2">
        <Card className="flex flex-col">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-section text-bone-100">Beta</h2>
            <Badge tone="accent">Now</Badge>
          </div>
          <p className="mt-4 text-metric-xl text-bone-100">Free</p>
          <ul className="mt-6 flex-1 space-y-2.5">
            {[
              'Everything in the beta, with no limits on activities or routes',
              'Your data is yours and exportable when export ships',
              'Direct line to the people building it',
            ].map((item) => (
              <li key={item} className="flex gap-3 text-secondary">
                <span aria-hidden className="text-signal">—</span><span className="muted">{item}</span>
              </li>
            ))}
          </ul>
          <div className="mt-7"><ButtonLink href="/signup" block>Start free beta</ButtonLink></div>
        </Card>

        <Card className="flex flex-col">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-section text-bone-100">After the beta</h2>
            <Badge>Not yet decided</Badge>
          </div>
          <p className="mt-4 text-body muted">
            We have not set a price, and we are not going to pretend we have. What we will
            commit to now:
          </p>
          <ul className="mt-6 flex-1 space-y-2.5">
            {[
              'Beta accounts get notice well before anything changes',
              'Your existing training history stays readable, whatever you choose',
              'Nothing you have already recorded gets locked behind a new plan',
            ].map((item) => (
              <li key={item} className="flex gap-3 text-secondary">
                <span aria-hidden className="text-signal">—</span><span className="muted">{item}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}
