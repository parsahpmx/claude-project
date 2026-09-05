import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ApiRequestError, apiPublic } from '@/lib/api';
import { Section, Media, Chip, ButtonLink } from '@/components/ui/primitives';
import { formatDateLabel } from '@/lib/format';
import type { Article } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { article } = await apiPublic<{ article: Article }>(`/v1/catalog/articles/${slug}`);
    return { title: article.title, description: article.excerpt };
  } catch {
    return { title: 'Article' };
  }
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let article: Article;
  try {
    ({ article } = await apiPublic<{ article: Article }>(`/v1/catalog/articles/${slug}`));
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    throw error;
  }

  const paragraphs = (article.body ?? '').split('\n\n').filter(Boolean);

  return (
    <>
      <Section tone="dark" size="md">
        <div className="mx-auto max-w-3xl pt-20 text-center">
          <Link href="/blog" className="text-xs uppercase tracking-[0.14em] text-bone-200/55 hover:text-bone-100">
            ← Knowledge Hub
          </Link>
          <div className="mt-6"><Chip tone="inverse">{article.category}</Chip></div>
          <h1 className="display mt-6 text-display-md text-balance">{article.title}</h1>
          <p className="mt-6 text-lg leading-relaxed text-bone-200/70">{article.excerpt}</p>
          <p className="mt-8 text-sm text-muted">
            {article.authorName} · {article.authorRole} · {article.readMinutes} min read ·{' '}
            {formatDateLabel(article.publishedOn)}
          </p>
        </div>
      </Section>

      <Section tone="light" size="md">
        <div className="mx-auto max-w-4xl">
          <Media imageKey={article.imageKey} ratio="21/9" alt={article.title} />
          <article className="mx-auto mt-14 max-w-prose">
            {paragraphs.map((paragraph, index) => (
              <p
                key={index}
                className={index === 0 ? 'text-xl leading-relaxed' : 'mt-6 text-base leading-relaxed opacity-85'}
              >
                {paragraph}
              </p>
            ))}
          </article>

          <div className="light-surface mx-auto mt-16 max-w-prose rounded-card border border-ink-900/10 bg-bone-100 p-8 text-center">
            <p className="display text-display-sm">PUT IT INTO PRACTICE.</p>
            <p className="mt-3 text-sm text-muted">
              The assessment turns this into a plan in about two minutes.
            </p>
            <div className="mt-6 flex justify-center">
              <ButtonLink href="/assessment" size="lg">Take the Assessment</ButtonLink>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
