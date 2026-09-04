import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiRequestError, apiPublic } from '@/lib/api';
import { Section, Card, Chip, Media, ButtonLink, Stat } from '@/components/ui/primitives';
import { formatMinutes } from '@/lib/format';
import type { Recipe } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface RecipeDetail {
  recipe: Recipe;
  ingredients: { name: string; quantity: number; unit: string; section: string }[];
}

export default async function RecipePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let detail: RecipeDetail;
  try {
    detail = await apiPublic<RecipeDetail>(`/v1/catalog/recipes/${slug}`);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    throw error;
  }

  const { recipe, ingredients } = detail;
  const totalMinutes = recipe.prepMinutes + recipe.cookMinutes;

  return (
    <>
      <Section tone="light" size="md">
        <div className="pt-20">
          <Link href="/nutrition" className="text-xs uppercase tracking-[0.14em] opacity-55 hover:opacity-100">
            ← Nutrition
          </Link>

          <div className="mt-8 grid gap-12 lg:grid-cols-2 lg:gap-16">
            <Media imageKey={recipe.imageKey} ratio="4/3" alt={recipe.name} />

            <div>
              <p className="eyebrow">{recipe.slot}</p>
              <h1 className="display mt-3 text-display-md text-balance">{recipe.name}</h1>
              <p className="mt-5 text-lg leading-relaxed opacity-80">{recipe.summary}</p>

              <div className="mt-7 flex flex-wrap gap-2">
                {recipe.tags.map((tag) => <Chip key={tag}>{tag.replace(/-/g, ' ')}</Chip>)}
              </div>

              <dl className="mt-9 grid grid-cols-2 gap-6 sm:grid-cols-4">
                <Stat label="Calories" value={recipe.calories} hint="per serving" />
                <Stat label="Protein" value={`${recipe.proteinGrams}g`} />
                <Stat label="Carbs" value={`${recipe.carbGrams}g`} />
                <Stat label="Fat" value={`${recipe.fatGrams}g`} />
              </dl>

              <dl className="mt-8 grid grid-cols-3 gap-6 border-t border-ink-900/10 pt-6">
                <Stat label="Prep" value={formatMinutes(recipe.prepMinutes)} />
                <Stat label="Cook" value={recipe.cookMinutes > 0 ? formatMinutes(recipe.cookMinutes) : 'None'} />
                <Stat label="Serves" value={recipe.servings} />
              </dl>

              <div className="mt-9 flex flex-wrap gap-3">
                <ButtonLink href="/app/nutrition" size="lg">Log This Meal</ButtonLink>
                <ButtonLink href="/app/nutrition" variant="ghost" size="lg">Add to Shopping List</ButtonLink>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section tone="bone" size="md">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
          <Card>
            <p className="eyebrow mb-5">Ingredients</p>
            <p className="mb-4 text-xs opacity-50">For {recipe.servings} serving{recipe.servings === 1 ? '' : 's'}</p>
            <ul className="space-y-3">
              {ingredients.map((ingredient) => (
                <li key={`${ingredient.name}-${ingredient.unit}`} className="flex justify-between gap-4 border-b border-ink-900/8 pb-3 text-sm last:border-0">
                  <span>{ingredient.name}</span>
                  <span className="shrink-0 tabular-nums opacity-60">
                    {trim(ingredient.quantity)} {ingredient.unit}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <div>
            <p className="eyebrow mb-5">Method</p>
            <ol className="space-y-6">
              {recipe.instructions.map((step, index) => (
                <li key={index} className="flex gap-5">
                  <span aria-hidden className="display shrink-0 text-2xl leading-none text-ember">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <p className="pt-1 leading-relaxed opacity-85">{step}</p>
                </li>
              ))}
            </ol>

            <div className="mt-10 rounded-card border border-ink-900/10 bg-bone-100 p-6">
              <p className="eyebrow mb-2">Difficulty</p>
              <p className="text-sm capitalize opacity-75">
                {recipe.difficulty} · {formatMinutes(totalMinutes)} total
              </p>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}
