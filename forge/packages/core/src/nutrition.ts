import type { AgeRange, DietPreference, Goal, SexAtBirth } from './types.js';
import { clamp } from './units.js';

/**
 * Nutrition targets.
 *
 * Mifflin-St Jeor for resting metabolic rate, an activity multiplier from the
 * member's actual scheduled training rather than a self-reported "activity
 * level", then a goal-driven adjustment bounded at ±20%. The bound matters:
 * an unbounded deficit is the one place a fitness product can do real harm, so
 * the floor is enforced here in the domain rather than in a UI validator that
 * a second client could forget to apply.
 */

export interface MacroTargets {
  calories: number;
  proteinGrams: number;
  carbGrams: number;
  fatGrams: number;
  fibreGrams: number;
  waterLitres: number;
}

export interface NutritionInputs {
  weightKg: number;
  heightCm: number;
  ageRange: AgeRange;
  sexAtBirth: SexAtBirth;
  goal: Goal;
  trainingDaysPerWeek: number;
  diet: DietPreference;
}

const AGE_MIDPOINT: Record<AgeRange, number> = {
  '18-24': 21,
  '25-34': 30,
  '35-44': 40,
  '45-54': 50,
  '55-64': 60,
  '65+': 70,
};

/** Never prescribe below this, whatever the goal maths says. */
export const ABSOLUTE_CALORIE_FLOOR = 1500;

export function restingMetabolicRate(input: {
  weightKg: number;
  heightCm: number;
  ageYears: number;
  sexAtBirth: SexAtBirth;
}): number {
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.ageYears;
  // Mifflin-St Jeor differs by ±5/-161. "Prefer not to say" takes the midpoint
  // rather than defaulting to either, which keeps the estimate honest.
  const offset = input.sexAtBirth === 'male' ? 5 : input.sexAtBirth === 'female' ? -161 : -78;
  return Math.round(base + offset);
}

export function activityMultiplier(trainingDaysPerWeek: number): number {
  const days = clamp(trainingDaysPerWeek, 0, 7);
  return 1.2 + days * 0.058;
}

const GOAL_ADJUSTMENT: Record<Goal, number> = {
  'build-muscle': 0.1,
  'lose-body-fat': -0.18,
  'improve-strength': 0.05,
  'improve-endurance': 0.05,
  'build-healthy-habits': 0,
  'improve-mobility': 0,
  'train-for-competition': 0.03,
};

/** Grams of protein per kg of bodyweight. */
const GOAL_PROTEIN_PER_KG: Record<Goal, number> = {
  'build-muscle': 2.0,
  'lose-body-fat': 2.2,
  'improve-strength': 1.9,
  'improve-endurance': 1.6,
  'build-healthy-habits': 1.5,
  'improve-mobility': 1.5,
  'train-for-competition': 2.0,
};

/** Plant-forward diets get a modest protein bump for lower digestibility. */
const DIET_PROTEIN_MODIFIER: Record<DietPreference, number> = {
  balanced: 1,
  'high-protein': 1.12,
  vegetarian: 1.05,
  vegan: 1.1,
  pescatarian: 1,
  'gluten-free': 1,
  'dairy-free': 1,
};

export function computeMacroTargets(input: NutritionInputs): MacroTargets {
  const ageYears = AGE_MIDPOINT[input.ageRange];
  const rmr = restingMetabolicRate({
    weightKg: input.weightKg,
    heightCm: input.heightCm,
    ageYears,
    sexAtBirth: input.sexAtBirth,
  });

  const maintenance = rmr * activityMultiplier(input.trainingDaysPerWeek);
  const adjustment = clamp(GOAL_ADJUSTMENT[input.goal], -0.2, 0.2);
  const rawCalories = maintenance * (1 + adjustment);

  // Two floors: an absolute one, and a relative one at 1.1× RMR so a very
  // small member is never pushed under their own resting requirement.
  const calories = Math.round(
    Math.max(rawCalories, ABSOLUTE_CALORIE_FLOOR, rmr * 1.1) / 10,
  ) * 10;

  const proteinGrams = Math.round(
    input.weightKg * GOAL_PROTEIN_PER_KG[input.goal] * DIET_PROTEIN_MODIFIER[input.diet],
  );

  // Fat at 25% of calories, floored at 0.7 g/kg for hormonal health.
  const fatGrams = Math.max(
    Math.round((calories * 0.25) / 9),
    Math.round(input.weightKg * 0.7),
  );

  const remainingCalories = calories - proteinGrams * 4 - fatGrams * 9;
  const carbGrams = Math.max(50, Math.round(remainingCalories / 4));

  return {
    calories,
    proteinGrams,
    carbGrams,
    fatGrams,
    fibreGrams: Math.round(clamp(calories / 1000, 1, 5) * 14),
    waterLitres: Math.round(clamp(input.weightKg * 0.035 + input.trainingDaysPerWeek * 0.05, 1.8, 5) * 10) / 10,
  };
}

export const MEAL_SLOTS = ['breakfast', 'lunch', 'snack', 'dinner'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  snack: 'Snack',
  dinner: 'Dinner',
};

/** Share of the day's calories per meal. Must sum to 1. */
const MEAL_SPLIT: Record<MealSlot, number> = {
  breakfast: 0.25,
  lunch: 0.3,
  snack: 0.12,
  dinner: 0.33,
};

export interface MealTarget {
  slot: MealSlot;
  label: string;
  calories: number;
  proteinGrams: number;
  carbGrams: number;
  fatGrams: number;
}

export function splitMealTargets(targets: MacroTargets): MealTarget[] {
  return MEAL_SLOTS.map((slot) => {
    const share = MEAL_SPLIT[slot];
    return {
      slot,
      label: MEAL_SLOT_LABELS[slot],
      calories: Math.round(targets.calories * share),
      proteinGrams: Math.round(targets.proteinGrams * share),
      carbGrams: Math.round(targets.carbGrams * share),
      fatGrams: Math.round(targets.fatGrams * share),
    };
  });
}

export const SHOPPING_SECTIONS = [
  'produce',
  'protein',
  'dairy',
  'pantry',
  'frozen',
  'other',
] as const;
export type ShoppingSection = (typeof SHOPPING_SECTIONS)[number];

export const SHOPPING_SECTION_LABELS: Record<ShoppingSection, string> = {
  produce: 'Produce',
  protein: 'Protein',
  dairy: 'Dairy',
  pantry: 'Pantry',
  frozen: 'Frozen',
  other: 'Other',
};

export interface RecipeIngredient {
  name: string;
  quantity: number;
  unit: string;
  section: ShoppingSection;
}

export interface ShoppingListItem {
  name: string;
  quantity: number;
  unit: string;
  section: ShoppingSection;
  /** How many planned meals this line serves — shown as "for 3 meals". */
  recipeCount: number;
}

/**
 * Aggregate a week of planned recipes into one shopping list.
 *
 * Lines merge on name *and* unit. Merging 200 g of tomatoes with 2 tomatoes
 * would produce "202 tomatoes", so unit mismatches stay as separate lines —
 * an ugly list is recoverable, a wrong one sends the member home short.
 */
export function buildShoppingList(
  recipes: readonly { ingredients: readonly RecipeIngredient[]; servings: number }[],
  households = 1,
): ShoppingListItem[] {
  const merged = new Map<string, ShoppingListItem>();

  for (const recipe of recipes) {
    // Ingredient quantities are written for `recipe.servings` servings; rescale
    // them to the number of servings this household actually needs.
    const factor = households / Math.max(1, recipe.servings);
    for (const ingredient of recipe.ingredients) {
      const key = `${ingredient.name.toLowerCase()}|${ingredient.unit}`;
      const existing = merged.get(key);
      const quantity = ingredient.quantity * factor;
      if (existing) {
        existing.quantity += quantity;
        existing.recipeCount += 1;
      } else {
        merged.set(key, {
          name: ingredient.name,
          quantity,
          unit: ingredient.unit,
          section: ingredient.section,
          recipeCount: 1,
        });
      }
    }
  }

  return [...merged.values()]
    .map((item) => ({ ...item, quantity: Math.round(item.quantity * 100) / 100 }))
    .sort(
      (a, b) =>
        SHOPPING_SECTIONS.indexOf(a.section) - SHOPPING_SECTIONS.indexOf(b.section) ||
        a.name.localeCompare(b.name),
    );
}

export interface MacroProgress {
  consumed: number;
  target: number;
  remaining: number;
  percent: number;
  /** True once the member is meaningfully over — 105% of target. */
  over: boolean;
}

export function macroProgress(consumed: number, target: number): MacroProgress {
  const safeTarget = Math.max(1, target);
  return {
    consumed,
    target,
    remaining: Math.max(0, target - consumed),
    percent: clamp(Math.round((consumed / safeTarget) * 100), 0, 999),
    over: consumed > safeTarget * 1.05,
  };
}

/** Whether a recipe is compatible with a member's diet preference. */
export function recipeMatchesDiet(recipeTags: readonly string[], diet: DietPreference): boolean {
  const tags = new Set(recipeTags);
  switch (diet) {
    case 'balanced':
      return true;
    case 'high-protein':
      return tags.has('high-protein');
    case 'vegetarian':
      return tags.has('vegetarian') || tags.has('vegan');
    case 'vegan':
      return tags.has('vegan');
    case 'pescatarian':
      return tags.has('pescatarian') || tags.has('vegetarian') || tags.has('vegan');
    case 'gluten-free':
      return tags.has('gluten-free');
    case 'dairy-free':
      return tags.has('dairy-free') || tags.has('vegan');
    default:
      return true;
  }
}
