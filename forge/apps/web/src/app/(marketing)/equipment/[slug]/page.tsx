import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ApiRequestError, apiPublic } from '@/lib/api';
import { Section, SectionHeading, Card, Media, Chip, ButtonLink } from '@/components/ui/primitives';
import { ProgramCard } from '@/components/marketing/cards';
import { formatCents, formatRating, formatNumber } from '@/lib/format';
import type { Product, Program } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface ProductDetail {
  product: Product & { specs: Record<string, string> };
  compatiblePrograms: Program[];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { product } = await apiPublic<ProductDetail>(`/v1/catalog/products/${slug}`);
    return { title: product.name, description: product.summary };
  } catch {
    return { title: 'Equipment' };
  }
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let detail: ProductDetail;
  try {
    detail = await apiPublic<ProductDetail>(`/v1/catalog/products/${slug}`);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    throw error;
  }

  const { product, compatiblePrograms } = detail;

  return (
    <>
      <Section tone="light" size="md">
        <div className="pt-20">
          <Link href="/equipment" className="text-xs uppercase tracking-[0.14em] text-muted hover:opacity-100">
            ← Equipment
          </Link>

          <div className="mt-8 grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div className="space-y-4">
              <Media imageKey={product.imageKey} ratio="1/1" variant="light" alt={product.name} />
              <div className="grid grid-cols-3 gap-4">
                {['detail-a', 'detail-b', 'detail-c'].map((key) => (
                  <Media key={key} imageKey={`${product.imageKey}-${key}`} ratio="1/1" variant="light" alt={`${product.name} detail`} />
                ))}
              </div>
            </div>

            <div>
              <p className="eyebrow">{product.category}</p>
              <h1 className="display mt-3 text-display-md text-balance">{product.name}</h1>

              <div className="mt-4 flex items-center gap-3 text-sm">
                <span className="flex items-center gap-1">
                  <span aria-hidden className="text-accent">★</span>
                  <span className="font-semibold">{formatRating(product.ratingTenths)}</span>
                </span>
                <span className="text-muted">{formatNumber(product.reviewCount)} reviews</span>
              </div>

              <p className="mt-6 text-lg leading-relaxed opacity-80">{product.summary}</p>

              <div className="mt-8 flex flex-wrap items-baseline gap-4">
                <span className="display text-display-sm">{formatCents(product.priceCents)}</span>
                {product.compareAtCents && (
                  <span className="text-lg line-through text-muted">{formatCents(product.compareAtCents)}</span>
                )}
              </div>
              {product.financingMonths > 0 && (
                <p className="mt-2 text-sm text-muted">
                  or {formatCents(Math.round(product.priceCents / product.financingMonths))} a month for{' '}
                  {product.financingMonths} months, interest free
                </p>
              )}

              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonLink href="/signin" size="lg">Add to Basket</ButtonLink>
                <ButtonLink href="/app/equipment" variant="ghost" size="lg">Check Compatibility</ButtonLink>
              </div>

              <Card padded={false}>
                <div className="accent-tint mt-8 rounded-card border border-ember/25 bg-ember/[0.06] p-5">
                  <p className="eyebrow text-accent">Works with</p>
                  <p className="mt-2 font-semibold">
                    {compatiblePrograms.length} FORGE programme{compatiblePrograms.length === 1 ? '' : 's'}
                  </p>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {compatiblePrograms.map((program) => (
                      <li key={program.slug}>
                        <Link href={`/programs/${program.slug}`}>
                          <Chip tone="accent" size="sm">{program.name}</Chip>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>

              <dl className="mt-8 space-y-3 border-t border-ink-900/10 pt-6 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Warranty</dt>
                  <dd className="text-right">{product.warranty}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Shipping</dt>
                  <dd className="text-right">{product.shipping}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Availability</dt>
                  <dd className="text-right">{product.inStock ? 'In stock' : 'Out of stock'}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </Section>

      <Section tone="bone" size="md">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <SectionHeading eyebrow="Description" title="THE DETAIL." />
            <p className="mt-8 max-w-prose text-lg leading-relaxed">{product.description}</p>
          </div>
          <Card>
            <p className="eyebrow mb-5">Specifications</p>
            <dl className="space-y-3 text-sm">
              {Object.entries(product.specs).map(([key, value]) => (
                <div key={key} className="flex justify-between gap-4 border-b border-ink-900/8 pb-3 last:border-0">
                  <dt className="text-muted">{key}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </Section>

      {compatiblePrograms.length > 0 && (
        <Section tone="light" size="md">
          <SectionHeading eyebrow="Recommended" title="PROGRAMS THIS UNLOCKS." />
          <div className="mt-10 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {compatiblePrograms.slice(0, 3).map((program) => (
              <ProgramCard key={program.slug} program={program} />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
