import Link from 'next/link';
import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card, Chip, ButtonLink, Media } from '@/components/ui/primitives';
import { ProgressRing, ProgressBar } from '@/components/ui/charts';
import { EmptyState } from '@/components/ui/feedback';
import { ShoppingList } from '@/components/app/shopping-list';
import { apiFetch } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import type { Recipe } from '@/lib/types';

export const metadata = { title: 'Nutrition' };

export const dynamic = 'force-dynamic';

interface MacroProgress {
  consumed: number; target: number; remaining: number; percent: number; over: boolean;
}

interface NutritionDay {
  date: string;
  targets: { calories: number; proteinGrams: number; carbGrams: number; fatGrams: number; fibreGrams: number; waterMl: number } | null;
  mealTargets: { slot: string; label: string; calories: number; proteinGrams: number; carbGrams: number; fatGrams: number }[];
  macros: { calories: MacroProgress; protein: MacroProgress; carbs: MacroProgress; fat: MacroProgress } | null;
  meals: {
    slot: string;
    planned: { id: string; status: string; recipe: Recipe } | null;
    logged: { id: string; name: string; calories: number; proteinGrams: number }[];
  }[];
}

interface ShoppingResponse {
  weekStart: string;
  items: { id: string; name: string; quantity: number; unit: string; section: string; recipeCount: number; checked: boolean }[];
}

export default async function NutritionPage() {
  const [day, shopping] = await Promise.all([
    apiFetch<NutritionDay>('/v1/me/nutrition'),
    apiFetch<ShoppingResponse>('/v1/me/nutrition/shopping-list'),
  ]);

  if (!day.targets || !day.macros) {
    return (
      <AppSection>
        <PageHeader eyebrow="Nutrition" title="TODAY'S NUTRITION" />
        <div className="mt-10">
          <EmptyState
            icon="◐"
            title="No targets yet"
            body="FORGE calculates your targets from height, weight, age and the sessions on your plan. Add your measurements and they are ready immediately."
            action={<ButtonLink href="/app/profile">Complete Profile</ButtonLink>}
          />
        </div>
      </AppSection>
    );
  }

  const { targets, macros } = day;

  return (
    <AppSection>
      <PageHeader
        eyebrow="Nutrition"
        title="TODAY'S NUTRITION"
        lead={`${formatNumber(targets.calories)} kcal · ${targets.proteinGrams}g protein · ${targets.carbGrams}g carbs · ${targets.fatGrams}g fat`}
        action={<ButtonLink href="/nutrition" variant="ghost">Browse Recipes</ButtonLink>}
      />

      <nav aria-label="Nutrition sections" className="mt-6 flex flex-wrap gap-2">
        {['My Plan', 'Meals', 'Recipes', 'Shopping List', 'Macros', 'Favourites'].map((label, index) => (
          <a
            key={label}
            href={`#${label.toLowerCase().replace(/\s/g, '-')}`}
            className={`min-h-[40px] rounded-pill border px-4 text-xs font-medium leading-[38px] transition-colors ${
              index === 0 ? 'dark-surface border-ink-900 bg-ink-900 text-bone-100' : 'border-ink-900/15 hover:border-ink-900/40'
            }`}
          >
            {label}
          </a>
        ))}
      </nav>

      {/* --------------------------------------------------------- macros */}
      <section id="macros" className="mt-10 scroll-mt-24">
        <Card tone="dark">
          <div className="flex flex-wrap items-center justify-between gap-8">
            <div>
              <p className="eyebrow">Consumed today</p>
              <p className="display mt-2 text-display-md tabular-nums text-bone-100">
                {formatNumber(macros.calories.consumed)}
                <span className="text-lg font-normal text-muted"> / {formatNumber(targets.calories)}</span>
              </p>
              <p className="mt-2 text-sm text-bone-200/55">
                {macros.calories.remaining > 0
                  ? `${formatNumber(macros.calories.remaining)} kcal remaining`
                  : 'Target met for today'}
              </p>
            </div>

            <div className="flex flex-wrap gap-8">
              <ProgressRing value={macros.protein.percent} label="Protein" sublabel={`${targets.proteinGrams}g`} tone="accent" />
              <ProgressRing value={macros.carbs.percent} label="Carbs" sublabel={`${targets.carbGrams}g`} tone="neutral" />
              <ProgressRing value={macros.fat.percent} label="Fat" sublabel={`${targets.fatGrams}g`} tone="neutral" />
            </div>
          </div>

          <div className="rule my-7" />

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <MacroBar label="Calories" progress={macros.calories} unit="kcal" />
            <MacroBar label="Protein" progress={macros.protein} unit="g" />
            <MacroBar label="Carbs" progress={macros.carbs} unit="g" />
            <MacroBar label="Fat" progress={macros.fat} unit="g" />
          </div>
        </Card>
      </section>

      {/* --------------------------------------------------------- meals */}
      <section id="meals" className="mt-10 scroll-mt-24">
        <h2 className="eyebrow mb-5">Today&rsquo;s meals</h2>
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {day.meals.map((meal) => {
            const target = day.mealTargets.find((t) => t.slot === meal.slot);
            return (
              <Card key={meal.slot} padded={false}>
                {meal.planned ? (
                  <>
                    <Media
                      imageKey={meal.planned.recipe.imageKey}
                      ratio="4/3"
                      rounded={false}
                      alt={meal.planned.recipe.name}
                    />
                    <div className="p-5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="eyebrow">{meal.slot}</p>
                        {meal.planned.status === 'logged' && <Chip tone="good" size="sm">Logged</Chip>}
                      </div>
                      <h3 className="mt-2 font-semibold leading-snug">{meal.planned.recipe.name}</h3>
                      <p className="mt-2 text-xs text-muted">
                        {meal.planned.recipe.calories} kcal · {meal.planned.recipe.proteinGrams}g protein ·{' '}
                        {meal.planned.recipe.prepMinutes + meal.planned.recipe.cookMinutes} min
                      </p>
                      {target && (
                        <p className="mt-1 text-[0.6875rem] text-muted">
                          Target for this slot: {target.calories} kcal
                        </p>
                      )}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          href={`/nutrition/recipes/${meal.planned.recipe.slug}`}
                          className="text-xs font-semibold uppercase tracking-[0.08em] text-accent"
                        >
                          View recipe →
                        </Link>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="p-5">
                    <p className="eyebrow">{meal.slot}</p>
                    <p className="mt-3 text-sm text-muted">Nothing planned for this slot.</p>
                    <div className="mt-4">
                      <ButtonLink href="/nutrition" variant="ghost" size="sm">Pick a meal</ButtonLink>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      {/* --------------------------------------------------- shopping list */}
      <section id="shopping-list" className="mt-12 scroll-mt-24">
        <h2 className="eyebrow mb-5">This week&rsquo;s shopping list</h2>
        <ShoppingList weekStart={shopping.weekStart} items={shopping.items} />
      </section>
    </AppSection>
  );
}

function MacroBar({ label, progress, unit }: { label: string; progress: MacroProgress; unit: string }) {
  return (
    <div>
      <ProgressBar
        value={progress.consumed}
        max={progress.target}
        label={label}
        valueLabel={`${formatNumber(progress.consumed)} / ${formatNumber(progress.target)}${unit === 'g' ? 'g' : ''}`}
        tone={progress.over ? 'warn' : progress.percent >= 90 ? 'good' : 'accent'}
      />
      {progress.over && (
        <p className="mt-2 text-[0.6875rem] text-status-warn">
          <span aria-hidden>!</span> Over target — not a problem on a training day, worth watching across a week.
        </p>
      )}
    </div>
  );
}
