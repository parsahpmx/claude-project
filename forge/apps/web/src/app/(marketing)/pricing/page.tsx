import { PricingTable } from '@/components/marketing/pricing-table';
import { Section, SectionHeading, Card } from '@/components/ui/primitives';
import { apiPublic } from '@/lib/api';
import type { PlanTierDefinition } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Pricing',
  description: 'Three plans, a seven-day free trial, and no hidden fees.',
};

const FAQ = [
  {
    q: 'What happens at the end of the trial?',
    a: 'Your plan starts billing on the date shown at checkout, which is also on your confirmation email and in Billing. Cancel before that date and you are not charged at all.',
  },
  {
    q: 'Can I change plan later?',
    a: 'Any time, in both directions. Changes take effect immediately and the difference is prorated against your current period.',
  },
  {
    q: 'What happens to my data if I cancel?',
    a: 'You keep access until the end of the period you have paid for. Your training history, personal records and progress stay in your account, and you can export them at any point.',
  },
  {
    q: 'Is FORGE COACH the same coach every month?',
    a: 'Yes. You choose a specific coach and they stay yours. If it is not working you can change coach without changing plan.',
  },
  {
    q: 'Do I need equipment?',
    a: 'No. Bodyweight Strength, Beginner Foundation, Mobility Reset and the running programmes need nothing at all. The assessment asks what you own and only recommends what you can actually run.',
  },
  {
    q: 'Is there a contract?',
    a: 'No. Monthly plans are month to month. Yearly plans are paid up front at a discount and can be cancelled for a prorated refund of unused whole months.',
  },
];

export default async function PricingPage() {
  const { plans } = await apiPublic<{ plans: PlanTierDefinition[] }>('/v1/catalog/plans');

  return (
    <>
      <Section tone="dark" size="lg">
        <div className="mx-auto max-w-3xl pt-16 text-center">
          <p className="eyebrow mb-6">Pricing</p>
          <h1 className="display text-display-lg text-balance">ONE SYSTEM.<br />THREE LEVELS OF SUPPORT.</h1>
          <p className="mt-6 text-lg leading-relaxed text-bone-200/70">
            Every plan starts with a seven-day free trial. Cancel any time before it ends and you are not
            charged.
          </p>
        </div>
      </Section>

      <Section tone="light" size="md">
        <PricingTable plans={plans} />
      </Section>

      <Section tone="bone" size="md">
        <SectionHeading eyebrow="Compare" title="WHAT CHANGES BETWEEN PLANS." />
        <div className="mt-10 w-full max-w-full overflow-x-auto rounded-card border border-ink-900/10 bg-bone-100">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Feature comparison across FORGE plans</caption>
            <thead>
              <tr className="border-b border-ink-900/10">
                <th scope="col" className="p-5 text-left font-semibold">Feature</th>
                {plans.map((plan) => (
                  <th key={plan.tier} scope="col" className="p-5 text-left font-semibold">{plan.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.label} className="border-b border-ink-900/8 last:border-0">
                  <th scope="row" className="p-5 text-left font-normal opacity-75">{row.label}</th>
                  {row.values.map((value, index) => (
                    <td key={index} className="p-5">
                      {value === true ? (
                        <span className="text-signal-good"><span aria-hidden>✓</span><span className="sr-only">Included</span></span>
                      ) : value === false ? (
                        <span className="opacity-30"><span aria-hidden>—</span><span className="sr-only">Not included</span></span>
                      ) : (
                        <span className="opacity-80">{value}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section tone="light" size="md">
        <SectionHeading eyebrow="Questions" title="THE THINGS PEOPLE ASK." />
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

      <Section tone="dark" size="md">
        <div className="grid gap-6 sm:grid-cols-3">
          {[
            ['Cancel anytime', 'Month-to-month with no notice period and no cancellation fee.'],
            ['Secure payments', 'Card details are handled by the payment processor. FORGE stores only the last four digits.'],
            ['No hidden fees', 'The price you see at checkout is the price billed. Nothing is added later.'],
          ].map(([title, body]) => (
            <Card key={title} tone="dark">
              <p className="display text-lg">{title}</p>
              <p className="mt-2 text-sm leading-relaxed text-bone-200/65">{body}</p>
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}

const COMPARISON: { label: string; values: (boolean | string)[] }[] = [
  { label: 'Personalised training plan', values: [true, true, true] },
  { label: 'Full workout and programme library', values: [true, true, true] },
  { label: 'Nutrition targets, meals and shopping list', values: [true, true, true] },
  { label: 'Recovery and mobility sessions', values: [true, true, true] },
  { label: 'Progress analytics', values: ['Standard', 'Advanced', 'Advanced'] },
  { label: 'FORGE AI assistant', values: ['Standard', 'With session analysis', 'With session analysis'] },
  { label: 'Adaptive training from readiness', values: [false, true, true] },
  { label: 'Wearable insights', values: [false, true, true] },
  { label: 'Dedicated human coach', values: [false, false, true] },
  { label: 'Weekly check-in with written response', values: [false, false, true] },
  { label: 'Video form review', values: [false, false, true] },
  { label: 'Monthly 1-to-1 video session', values: [false, false, true] },
];
