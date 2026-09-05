import { Section, SectionHeading, Chip } from '@/components/ui/primitives';
import { ArticleCard } from '@/components/marketing/cards';
import { apiPublic } from '@/lib/api';
import type { Article } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Knowledge Hub',
  description: 'Training, nutrition, recovery, mindset and the science underneath them.',
};

export default async function BlogPage() {
  const { articles, categories } = await apiPublic<{ articles: Article[]; categories: string[] }>(
    '/v1/catalog/articles',
  );
  const featured = articles.filter((a) => a.featured);
  const rest = articles.filter((a) => !a.featured);

  return (
    <>
      <Section tone="dark" size="lg">
        <div className="max-w-4xl pt-16">
          <p className="eyebrow mb-6">Knowledge hub</p>
          <h1 className="display text-display-lg text-balance">TRAIN WITH REASONS.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-bone-200/70">
            Written by the coaches who build the programmes. No listicles, no supplements to sell, no claims
            that outrun the evidence.
          </p>
        </div>
      </Section>

      <Section tone="light" size="md">
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => <Chip key={category}>{category}</Chip>)}
        </div>

        {featured.length > 0 && (
          <div className="mt-12">
            <SectionHeading eyebrow="Featured" title="START HERE." />
            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              {featured.map((article) => <ArticleCard key={article.slug} article={article} featured />)}
            </div>
          </div>
        )}

        <SectionHeading eyebrow="All articles" title="EVERYTHING ELSE." />
        <div className="mt-10 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {rest.map((article) => <ArticleCard key={article.slug} article={article} />)}
        </div>
      </Section>
    </>
  );
}
