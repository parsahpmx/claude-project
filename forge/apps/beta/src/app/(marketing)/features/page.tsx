import { Card, Badge, ButtonLink } from '@/components/ui/primitives';
import { CAPABILITIES } from '@/lib/marketing';

export const metadata = {
  title: 'Features',
  description: 'What FORGE does today, what is optional in the beta, and what comes after it.',
};

export default function FeaturesPage() {
  return (
    <>
      <section className="shell border-b border-ink-600/60 py-16">
        <p className="eyebrow">Features</p>
        <h1 className="mt-4 max-w-3xl text-display font-display text-bone-100 text-balance">
          What FORGE does, and what it does not do yet
        </h1>
        <p className="mt-5 max-w-prose text-body muted">
          Each capability below says where it stands. Anything marked as coming after
          the beta is not in the product today, and we would rather say so here than
          have you find out later.
        </p>
      </section>

      <section className="shell py-16">
        <ul className="grid gap-5 lg:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <li key={c.slug}>
              <Card as="article" className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-section text-bone-100">{c.title}</h2>
                  <Badge tone={c.state === 'In the beta' ? 'good' : c.state === 'Optional in the beta' ? 'warn' : 'neutral'}>
                    {c.state}
                  </Badge>
                </div>
                <p className="mt-2.5 text-secondary muted">{c.lead}</p>
                <ul className="mt-5 flex-1 space-y-2.5">
                  {c.points.map((point) => (
                    <li key={point} className="flex gap-3 text-secondary">
                      <span aria-hidden className="text-signal">—</span>
                      <span className="muted">{point}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
        <div className="mt-12">
          <ButtonLink href="/signup" size="lg">Start free beta</ButtonLink>
        </div>
      </section>
    </>
  );
}
