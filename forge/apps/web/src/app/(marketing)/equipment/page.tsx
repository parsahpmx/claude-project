import { Section, SectionHeading, Card, ButtonLink, Chip } from '@/components/ui/primitives';
import { ProductCard } from '@/components/marketing/cards';
import { apiPublic } from '@/lib/api';
import type { Product } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Equipment',
  description: 'Equipment chosen for the programmes it unlocks, not for the margin.',
};

const BY_GOAL = [
  { goal: 'improve-strength', label: 'Build Strength' },
  { goal: 'build-healthy-habits', label: 'Start Training' },
  { goal: 'build-muscle', label: 'Train at Home' },
  { goal: 'improve-endurance', label: 'Improve Conditioning' },
  { goal: 'improve-mobility', label: 'Mobility & Recovery' },
];

export default async function EquipmentPage() {
  const { products, categories } = await apiPublic<{ products: Product[]; categories: string[] }>(
    '/v1/catalog/products',
  );

  return (
    <>
      <Section tone="dark" size="lg">
        <div className="max-w-4xl pt-16">
          <p className="eyebrow mb-6">Equipment</p>
          <h1 className="display text-display-lg text-balance">BUY THE THING THAT UNLOCKS THE PLAN.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-bone-200/70">
            Every product page tells you exactly which FORGE programmes it opens up. Nothing here exists to
            fill a category — if it does not change what you can train, it is not in the store.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <ButtonLink href="/app/equipment" size="lg">Update My Equipment</ButtonLink>
            <ButtonLink href="#shop" variant="inverse" size="lg">Shop Now</ButtonLink>
          </div>
        </div>
      </Section>

      <Section tone="light" size="md">
        <SectionHeading eyebrow="Browse by goal" title="WHAT ARE YOU TRYING TO DO?" />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {BY_GOAL.map((entry) => (
            <a
              key={entry.goal}
              href={`#shop`}
              className="light-surface group rounded-card border border-ink-900/12 bg-bone-100 p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-lift"
            >
              <p className="display text-lg leading-tight">{entry.label}</p>
              <p className="mt-3 text-xs uppercase tracking-[0.1em] text-accent">
                {products.filter((p) => p.goals.includes(entry.goal)).length} products →
              </p>
            </a>
          ))}
        </div>
      </Section>

      <Section tone="bone" size="md" id="shop">
        <SectionHeading eyebrow="The store" title="EVERY CATEGORY." />
        <div className="mt-8 flex flex-wrap gap-2">
          {categories.map((category) => <Chip key={category}>{category}</Chip>)}
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {products.map((product) => <ProductCard key={product.slug} product={product} />)}
        </div>
      </Section>

      <Section tone="dark" size="md">
        <div className="grid gap-6 sm:grid-cols-3">
          {[
            ['Programme compatibility', 'Every product lists the exact programmes it unlocks, verified against the movement library.'],
            ['Financing available', 'Spread larger purchases over 6, 12 or 24 months at no extra cost.'],
            ['Free delivery over $150', 'Kerbside for racks and rowers, doorstep for everything else.'],
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
