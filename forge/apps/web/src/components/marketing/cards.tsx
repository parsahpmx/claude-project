import Link from 'next/link';
import { Media } from '@/components/ui/primitives';
import { Chip } from '@/components/ui/primitives';
import { formatCents, formatMinutes, formatRating } from '@/lib/format';
import type { Article, CoachCard as CoachCardData, Product, Program, Recipe } from '@/lib/types';

/**
 * Content cards.
 *
 * One card component per content type, used identically on the marketing site
 * and inside the app. That is what makes a programme feel like the same object
 * whether a visitor is browsing it or a member is running it.
 */

export function ProgramCard({ program, href }: { program: Program; href?: string }) {
  return (
    <Link
      href={href ?? `/programs/${program.slug}`}
      className="group flex flex-col overflow-hidden rounded-card border border-ink-900/10 bg-bone-100 transition-all duration-300 ease-forge hover:-translate-y-1 hover:shadow-lift"
    >
      <Media imageKey={program.accentImage} ratio="4/3" rounded={false} overlay alt={`${program.name} programme`}>
        <div className="flex h-full flex-col justify-between p-5">
          <div className="flex justify-between gap-2">
            <Chip tone="inverse" size="sm">{program.weeks} weeks</Chip>
            <Chip tone="inverse" size="sm">
              <span aria-hidden>★</span> {program.rating.toFixed(1)}
            </Chip>
          </div>
          <div>
            <h3 className="display text-2xl leading-none text-bone-100">{program.name}</h3>
            <p className="mt-1.5 text-xs text-bone-200/75">{program.tagline}</p>
          </div>
        </div>
      </Media>

      <div className="flex flex-1 flex-col p-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
          <Detail label="Difficulty" value={capitalise(program.difficulty)} />
          <Detail label="Sessions" value={`${program.sessionsPerWeek} / week`} />
          <Detail label="Session" value={formatMinutes(program.sessionMinutes)} />
          <Detail label="Where" value={capitalise(program.location)} />
        </dl>

        <p className="mt-4 line-clamp-2 text-sm leading-relaxed opacity-65">{program.summary}</p>

        <div className="mt-auto flex items-center justify-between pt-5">
          <span className="text-[0.6875rem] uppercase tracking-[0.1em] opacity-50">
            {program.progression.replace(/-/g, ' ')}
          </span>
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ember transition-transform group-hover:translate-x-0.5">
            View Program →
          </span>
        </div>
      </div>
    </Link>
  );
}

export function WorkoutCard({
  title,
  style,
  minutes,
  level,
  coach,
  format,
  imageKey,
  href,
}: {
  title: string;
  style: string;
  minutes: number;
  level: string;
  coach?: string;
  format: 'COACHED' | 'SELF-GUIDED';
  imageKey: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group block overflow-hidden rounded-card border border-ink-900/10 bg-bone-100 transition-all duration-300 ease-forge hover:-translate-y-1 hover:shadow-lift"
    >
      <Media imageKey={imageKey} ratio="16/9" rounded={false} overlay alt={`${title} workout`}>
        <div className="flex h-full flex-col justify-between p-4">
          <div className="flex justify-between">
            <Chip tone="inverse" size="sm">{format}</Chip>
            <Chip tone="inverse" size="sm">{formatMinutes(minutes)}</Chip>
          </div>
          <span
            aria-hidden
            className="grid h-11 w-11 place-items-center rounded-full bg-bone-100/95 text-ink-900 transition-transform duration-300 group-hover:scale-110"
          >
            ▶
          </span>
        </div>
      </Media>
      <div className="p-4">
        <p className="eyebrow">{style}</p>
        <h3 className="mt-1.5 font-semibold leading-snug">{title}</h3>
        <p className="mt-1 text-xs opacity-55">
          {capitalise(level)}
          {coach ? ` · ${coach}` : ''}
        </p>
      </div>
    </Link>
  );
}

export function CoachCard({ coach }: { coach: CoachCardData }) {
  return (
    <Link
      href={`/coaching/${coach.slug}`}
      className="group flex gap-5 rounded-card border border-ink-900/10 bg-bone-100 p-5 transition-all duration-300 ease-forge hover:-translate-y-1 hover:shadow-lift"
    >
      <div className="w-24 shrink-0 sm:w-28">
        <Media imageKey={coach.imageKey} ratio="3/4" alt={`${coach.firstName} ${coach.lastName}, coach`} />
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="display text-lg leading-none">
          {coach.firstName} {coach.lastName}
        </h3>
        <p className="mt-1.5 text-xs opacity-60">{coach.headline}</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="flex items-center gap-1 font-semibold">
            <span aria-hidden className="text-ember">★</span>
            {formatRating(coach.ratingTenths)}
          </span>
          <span className="opacity-55">{coach.clientCount} clients</span>
          <span className="opacity-55">{coach.yearsExperience} yrs</span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {coach.specialties.slice(0, 3).map((specialty) => (
            <Chip key={specialty} size="sm">{specialty.replace(/-/g, ' ')}</Chip>
          ))}
        </div>

        {coach.matchReasons && coach.matchReasons.length > 0 && (
          <p className="mt-3 text-xs leading-relaxed text-ember-600">{coach.matchReasons[0]}</p>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-xs">
            {coach.availableSlotsThisWeek > 0 ? (
              <span className="text-signal-good">✓ {coach.availableSlotsThisWeek} slots this week</span>
            ) : (
              <span className="opacity-50">○ Waitlist</span>
            )}
          </span>
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ember transition-transform group-hover:translate-x-0.5">
            View Coach →
          </span>
        </div>
      </div>
    </Link>
  );
}

export function RecipeCard({ recipe, href }: { recipe: Recipe; href?: string }) {
  return (
    <Link
      href={href ?? `/nutrition/recipes/${recipe.slug}`}
      className="group block overflow-hidden rounded-card border border-ink-900/10 bg-bone-100 transition-all duration-300 ease-forge hover:-translate-y-1 hover:shadow-lift"
    >
      <Media imageKey={recipe.imageKey} ratio="4/3" rounded={false} alt={recipe.name} />
      <div className="p-5">
        <div className="flex items-center gap-2">
          <p className="eyebrow">{recipe.slot}</p>
          <span aria-hidden className="h-1 w-1 rounded-full bg-current opacity-30" />
          <p className="text-[0.6875rem] opacity-55">{recipe.prepMinutes + recipe.cookMinutes} min</p>
        </div>
        <h3 className="mt-2 font-semibold leading-snug">{recipe.name}</h3>
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed opacity-60">{recipe.summary}</p>
        <dl className="mt-4 grid grid-cols-4 gap-2 border-t border-ink-900/10 pt-3 text-center">
          <Macro label="kcal" value={recipe.calories} />
          <Macro label="P" value={`${recipe.proteinGrams}g`} />
          <Macro label="C" value={`${recipe.carbGrams}g`} />
          <Macro label="F" value={`${recipe.fatGrams}g`} />
        </dl>
      </div>
    </Link>
  );
}

export function ProductCard({ product }: { product: Product }) {
  return (
    <Link
      href={`/equipment/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-card border border-ink-900/10 bg-bone-100 transition-all duration-300 ease-forge hover:-translate-y-1 hover:shadow-lift"
    >
      <Media imageKey={product.imageKey} ratio="1/1" rounded={false} variant="light" alt={product.name} />
      <div className="flex flex-1 flex-col p-5">
        <p className="eyebrow">{product.category}</p>
        <h3 className="mt-2 font-semibold leading-snug">{product.name}</h3>
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed opacity-60">{product.summary}</p>

        <p className="mt-3 text-xs text-ember-600">
          Works with {product.compatiblePrograms.length} FORGE programme
          {product.compatiblePrograms.length === 1 ? '' : 's'}
        </p>

        <div className="mt-auto flex items-end justify-between pt-5">
          <div>
            <p className="display text-lg leading-none">{formatCents(product.priceCents)}</p>
            {product.financingMonths > 0 && (
              <p className="mt-1 text-[0.6875rem] opacity-55">
                or {formatCents(Math.round(product.priceCents / product.financingMonths))}/mo
              </p>
            )}
          </div>
          <span className="flex items-center gap-1 text-xs">
            <span aria-hidden className="text-ember">★</span>
            <span className="font-semibold">{formatRating(product.ratingTenths)}</span>
            <span className="opacity-45">({product.reviewCount})</span>
          </span>
        </div>
      </div>
    </Link>
  );
}

export function ArticleCard({ article, featured = false }: { article: Article; featured?: boolean }) {
  return (
    <Link
      href={`/blog/${article.slug}`}
      className="group block overflow-hidden rounded-card border border-ink-900/10 bg-bone-100 transition-all duration-300 ease-forge hover:-translate-y-1 hover:shadow-lift"
    >
      <Media imageKey={article.imageKey} ratio={featured ? '21/9' : '16/9'} rounded={false} overlay alt={article.title}>
        <div className="flex h-full items-end p-5">
          <Chip tone="inverse" size="sm">{article.category}</Chip>
        </div>
      </Media>
      <div className="p-5">
        <h3 className={featured ? 'display text-display-sm leading-tight' : 'text-lg font-semibold leading-snug'}>
          {article.title}
        </h3>
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed opacity-65">{article.excerpt}</p>
        <p className="mt-4 text-xs opacity-50">
          {article.authorName} · {article.readMinutes} min read
        </p>
      </div>
    </Link>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.625rem] uppercase tracking-[0.12em] opacity-45">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

function Macro({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
      <dt className="text-[0.625rem] uppercase tracking-[0.12em] opacity-45">{label}</dt>
    </div>
  );
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
