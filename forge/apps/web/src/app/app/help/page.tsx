import Link from 'next/link';
import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card } from '@/components/ui/primitives';

const TOPICS = [
  ['How does my plan adapt?', 'Every logged set feeds the progression engine. Hit the rep target and load goes up; miss it and the plan holds or backs off. Your post-session difficulty rating adjusts the next session of the same kind by up to five percent.'],
  ['Why is my readiness score low?', 'Open the breakdown on Recovery. Each input is scored against your own rolling baseline. If sleep is the weak input, the fix is an earlier night rather than a lighter session.'],
  ['Can I train with different equipment?', 'Update your equipment in Profile. FORGE re-checks every remaining session and substitutes movements that train the same pattern with what you own.'],
  ['What if I miss a week?', 'Nothing breaks. Missed sessions stay visible as missed — the analytics are only useful if they are honest — and the plan carries on from where you actually are.'],
  ['How do I change coach?', 'End the current relationship in Coach, then choose a new one from the marketplace. Your plan, history and records are unaffected.'],
  ['Is FORGE medical advice?', 'No. FORGE is a training product. For pain, injury, pregnancy or any medical condition, speak to a qualified healthcare professional before training.'],
];

export default function HelpPage() {
  return (
    <AppSection>
      <PageHeader eyebrow="Help" title="HOW FORGE WORKS" />
      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        {TOPICS.map(([question, answer]) => (
          <details key={question} className="group rounded-card border border-ink-900/10 bg-bone-100 p-6">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
              {question}
              <span aria-hidden className="text-lg opacity-40 transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="mt-4 text-sm leading-relaxed opacity-70">{answer}</p>
          </details>
        ))}
      </div>

      <div className="mt-8">
        <Card>
          <p className="eyebrow mb-3">Still stuck?</p>
          <p className="text-sm leading-relaxed opacity-70">
            Ask <Link href="/app/ai" className="text-ember underline underline-offset-4">FORGE AI</Link> — it can
            see your plan and your history. For anything it cannot answer, your coach can.
          </p>
        </Card>
      </div>
    </AppSection>
  );
}
