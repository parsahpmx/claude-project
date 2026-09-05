import { Section, SectionHeading, Card, ButtonLink, Chip, Media } from '@/components/ui/primitives';
import { RecipeCard } from '@/components/marketing/cards';
import { ProgressRing } from '@/components/ui/charts';
import { apiPublic } from '@/lib/api';
import type { Recipe } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Nutrition',
  description: 'Targets calculated from your own physiology, with recipes and a weekly shopping list.',
};

const DIETS = ['Balanced', 'High Protein', 'Vegetarian', 'Vegan', 'Pescatarian', 'Gluten-Free', 'Dairy-Free'];

const SECTIONS = [
  { name: 'Produce', items: ['Sweet potato 800g', 'Baby spinach 240g', 'Avocado ×3', 'Limes ×4'] },
  { name: 'Protein', items: ['Chicken breast 800g', 'Sirloin steak 300g', 'Eggs ×12', 'Salmon fillet 300g'] },
  { name: 'Dairy', items: ['Greek yoghurt 650g', 'Cottage cheese 200g', 'Oat milk 1L'] },
  { name: 'Pantry', items: ['Rolled oats 400g', 'Basmati rice 300g', 'Whey protein 200g', 'Peanut butter'] },
  { name: 'Frozen', items: ['Mixed berries 400g', 'Frozen mango 200g'] },
];

export default async function NutritionPage() {
  const { recipes } = await apiPublic<{ recipes: Recipe[] }>('/v1/catalog/recipes');

  return (
    <>
      <Section tone="dark" size="lg">
        <div className="grid gap-12 pt-16 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <p className="eyebrow mb-6">Nutrition</p>
            <h1 className="display text-display-lg text-balance">EAT FOR THE TRAINING YOU ACTUALLY DID.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-bone-200/70">
              Targets calculated from your height, weight, age and the sessions on your plan — not a slider you
              guessed at. Recipes that match how you eat, and a shopping list that writes itself.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/assessment" size="lg">Get My Targets</ButtonLink>
              <ButtonLink href="#recipes" variant="inverse" size="lg">Browse Recipes</ButtonLink>
            </div>
          </div>

          <Card tone="dark">
            <p className="eyebrow mb-1">Today&rsquo;s nutrition</p>
            <p className="display text-display-sm text-bone-100">2,400 KCAL</p>
            <div className="mt-8 flex flex-wrap justify-between gap-6">
              <ProgressRing value={74} label="Protein" sublabel="170g" tone="accent" />
              <ProgressRing value={58} label="Carbs" sublabel="260g" tone="neutral" />
              <ProgressRing value={62} label="Fat" sublabel="75g" tone="neutral" />
            </div>
            <div className="rule my-7" />
            <ul className="space-y-3 text-sm">
              {[
                ['Breakfast', 'High-Protein Overnight Oats', '480 kcal'],
                ['Lunch', 'Coriander Chicken Rice Bowl', '620 kcal'],
                ['Snack', 'Post-Session Recovery Smoothie', '380 kcal'],
                ['Dinner', 'Steak & Sweet Potato Hash', '640 kcal'],
              ].map(([slot, meal, kcal]) => (
                <li key={slot} className="flex items-center justify-between gap-4 border-b border-bone-200/10 pb-3 last:border-0">
                  <div>
                    <p className="text-[0.625rem] uppercase tracking-[0.12em] text-muted">{slot}</p>
                    <p className="mt-0.5 text-bone-100">{meal}</p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-bone-200/55">{kcal}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      <Section tone="light" size="md">
        <SectionHeading
          eyebrow="How targets are set"
          title="MATHS, NOT A GUESS."
          lead="Mifflin-St Jeor for your resting rate, an activity multiplier from your actual scheduled sessions, then a goal adjustment bounded at 20% in either direction."
        />
        <div className="mt-12 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['01', 'Resting rate', 'Calculated from height, weight and age — the energy you burn doing nothing.'],
            ['02', 'Activity', 'Multiplied by the sessions your plan actually schedules, not a self-reported level.'],
            ['03', 'Goal adjustment', 'Capped at ±20%, with a hard floor at 1,500 kcal and never below your resting rate.'],
            ['04', 'Macro split', 'Protein by bodyweight and goal, fat floored for hormonal health, carbs fill the rest.'],
          ].map(([step, title, body]) => (
            <Card key={step}>
              <p className="display text-3xl leading-none text-accent">{step}</p>
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            </Card>
          ))}
        </div>
        <p className="mt-8 max-w-prose text-sm leading-relaxed text-muted">
          The floor is not a detail. An unbounded deficit is the one place a fitness product can do real harm,
          so it is enforced in the domain layer where every client — web, mobile and coach — hits the same rule.
        </p>
      </Section>

      <Section tone="bone" size="md" id="recipes">
        <SectionHeading
          eyebrow="Recipes"
          title="FOOD YOU WILL ACTUALLY COOK."
          action={<ButtonLink href="/assessment" variant="ghost">Get My Meal Plan</ButtonLink>}
        />
        <div className="mt-8 flex flex-wrap gap-2">
          {DIETS.map((diet) => <Chip key={diet}>{diet}</Chip>)}
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {recipes.slice(0, 8).map((recipe) => <RecipeCard key={recipe.slug} recipe={recipe} />)}
        </div>
      </Section>

      <Section tone="light" size="md">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="eyebrow mb-5">Shopping list</p>
            <h2 className="display text-display-md text-balance">YOUR WEEK, AGGREGATED BY AISLE.</h2>
            <p className="mt-6 max-w-prose leading-relaxed text-muted">
              Plan the week and FORGE merges every ingredient across every recipe into one list, sorted the way
              a shop is laid out. Lines only merge when the units match — 200g of tomatoes and 2 tomatoes stay
              separate, because an ugly list is recoverable and a wrong one sends you home short.
            </p>
            <div className="mt-8">
              <ButtonLink href="/assessment" size="lg">Build My Week</ButtonLink>
            </div>
          </div>

          <Card padded={false}>
            <div className="border-b border-ink-900/10 p-6">
              <div className="flex items-center justify-between">
                <p className="eyebrow">This week</p>
                <span className="text-xs text-muted">28 items · 5 sections</span>
              </div>
            </div>
            <div className="max-h-[440px] overflow-y-auto" tabIndex={0} role="region" aria-label="Shopping list">
              {SECTIONS.map((section) => (
                <div key={section.name} className="border-b border-ink-900/8 p-6 last:border-0">
                  <p className="eyebrow mb-4">{section.name}</p>
                  <ul className="space-y-3">
                    {section.items.map((item, index) => (
                      <li key={item} className="flex items-center gap-3 text-sm">
                        <span
                          aria-hidden
                          className={`grid h-5 w-5 shrink-0 place-items-center rounded-[4px] border text-[0.625rem] ${
                            index === 0 ? 'border-ember bg-ember-600 text-bone-100' : 'border-ink-900/25'
                          }`}
                        >
                          {index === 0 ? '✓' : ''}
                        </span>
                        <span className={index === 0 ? 'text-muted line-through' : 'opacity-80'}>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </Section>

      <Section tone="dark" size="md">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <Media imageKey="nutrition-prep" ratio="4/3" alt="Weekly meal preparation" />
          <div>
            <h2 className="display text-display-md text-balance">SWAP ANY MEAL. THE MATHS STILL WORKS.</h2>
            <p className="mt-6 leading-relaxed text-bone-200/70">
              Do not fancy the dinner? Swap it. FORGE only offers alternatives that fit your diet preference and
              lands the day within a few grams of your targets. Log something off-plan and the remaining meals
              adjust rather than the day being written off.
            </p>
            <ul className="mt-8 space-y-3">
              {['Swap meal', 'Save to favourites', 'Add to shopping list', 'Log meal'].map((action) => (
                <li key={action} className="flex gap-3 text-sm">
                  <span aria-hidden className="text-accent">→</span>
                  <span className="text-bone-200/75">{action}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>
    </>
  );
}
