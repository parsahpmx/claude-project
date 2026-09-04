import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import {
  addDays, buildShoppingList, computeMacroTargets, macroProgress, MEAL_SLOTS,
  randomId, recipeMatchesDiet, splitMealTargets, startOfWeek,
  type DietPreference, type RecipeIngredient, type ShoppingSection,
} from '@forge/core';
import {
  mealLogs, mealPlanEntries, memberProfiles, nutritionTargets, recipeFavourites,
  recipeIngredients, recipes, shoppingListItems,
} from '@forge/db';
import { badRequest, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireMember } from '../auth/guards.js';
import { isoDateSchema } from './schemas.js';

export async function registerNutritionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me/nutrition', async (request) => {
    const principal = requireMember(request.principal);
    const query = parse(z.object({ date: isoDateSchema.optional() }), request.query);
    const { db, today } = request.ctx;
    const date = query.date ?? today();

    const [targets] = await db
      .select().from(nutritionTargets).where(eq(nutritionTargets.userId, principal.userId)).limit(1);

    const planned = await db
      .select({
        id: mealPlanEntries.id, slot: mealPlanEntries.slot, status: mealPlanEntries.status,
        recipe: recipes,
      })
      .from(mealPlanEntries)
      .innerJoin(recipes, eq(recipes.id, mealPlanEntries.recipeId))
      .where(and(eq(mealPlanEntries.userId, principal.userId), eq(mealPlanEntries.date, date)));

    const logged = await db
      .select().from(mealLogs)
      .where(and(eq(mealLogs.userId, principal.userId), eq(mealLogs.date, date)));

    const consumed = logged.reduce(
      (totals, meal) => ({
        calories: totals.calories + meal.calories,
        protein: totals.protein + meal.proteinGrams,
        carbs: totals.carbs + meal.carbGrams,
        fat: totals.fat + meal.fatGrams,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );

    const macros = targets
      ? {
          calories: macroProgress(consumed.calories, targets.calories),
          protein: macroProgress(consumed.protein, targets.proteinGrams),
          carbs: macroProgress(consumed.carbs, targets.carbGrams),
          fat: macroProgress(consumed.fat, targets.fatGrams),
        }
      : null;

    return {
      date,
      targets: targets ?? null,
      mealTargets: targets
        ? splitMealTargets({
            calories: targets.calories, proteinGrams: targets.proteinGrams,
            carbGrams: targets.carbGrams, fatGrams: targets.fatGrams,
            fibreGrams: targets.fibreGrams, waterLitres: targets.waterMl / 1000,
          })
        : [],
      macros,
      meals: MEAL_SLOTS.map((slot) => ({
        slot,
        planned: planned.find((entry) => entry.slot === slot) ?? null,
        logged: logged.filter((meal) => meal.slot === slot),
      })),
    };
  });

  app.post('/me/nutrition/recalculate', async (request) => {
    const principal = requireMember(request.principal);
    const { db } = request.ctx;

    const [profile] = await db
      .select().from(memberProfiles).where(eq(memberProfiles.userId, principal.userId)).limit(1);
    if (!profile?.weightKg || !profile.heightCm) {
      throw badRequest(
        'missing_measurements',
        'Add your height and weight in your profile so targets can be calculated rather than guessed.',
      );
    }

    const macros = computeMacroTargets({
      weightKg: profile.weightKg, heightCm: profile.heightCm,
      ageRange: profile.ageRange as never, sexAtBirth: (profile.sexAtBirth ?? 'prefer-not-to-say') as never,
      goal: profile.primaryGoal as never, trainingDaysPerWeek: profile.daysPerWeek,
      diet: profile.diet as DietPreference,
    });

    const values = {
      calories: macros.calories, proteinGrams: macros.proteinGrams, carbGrams: macros.carbGrams,
      fatGrams: macros.fatGrams, fibreGrams: macros.fibreGrams,
      waterMl: Math.round(macros.waterLitres * 1000), updatedAt: new Date(),
    };

    const existing = await db
      .select({ userId: nutritionTargets.userId }).from(nutritionTargets)
      .where(eq(nutritionTargets.userId, principal.userId)).limit(1);

    if (existing.length > 0) {
      await db.update(nutritionTargets).set(values).where(eq(nutritionTargets.userId, principal.userId));
    } else {
      await db.insert(nutritionTargets).values({ userId: principal.userId, ...values });
    }
    return { ok: true, targets: macros };
  });

  app.post('/me/nutrition/log', async (request) => {
    const principal = requireMember(request.principal);
    const body = parse(
      z.object({
        date: isoDateSchema.optional(),
        slot: z.enum(MEAL_SLOTS),
        recipeSlug: z.string().max(80).optional(),
        name: z.string().max(140).optional(),
        calories: z.number().int().min(0).max(6000).optional(),
        proteinGrams: z.number().int().min(0).max(500).optional(),
        carbGrams: z.number().int().min(0).max(1000).optional(),
        fatGrams: z.number().int().min(0).max(400).optional(),
      }),
      request.body,
    );
    const { db, today } = request.ctx;
    const date = body.date ?? today();

    let payload = {
      name: body.name ?? 'Logged meal',
      recipeId: null as string | null,
      calories: body.calories ?? 0,
      proteinGrams: body.proteinGrams ?? 0,
      carbGrams: body.carbGrams ?? 0,
      fatGrams: body.fatGrams ?? 0,
    };

    if (body.recipeSlug) {
      const [recipe] = await db.select().from(recipes).where(eq(recipes.slug, body.recipeSlug)).limit(1);
      if (!recipe) throw notFound('Recipe');
      payload = {
        name: recipe.name, recipeId: recipe.id, calories: recipe.calories,
        proteinGrams: recipe.proteinGrams, carbGrams: recipe.carbGrams, fatGrams: recipe.fatGrams,
      };
    } else if (body.calories === undefined) {
      throw badRequest('missing_macros', 'Log a recipe, or give the calories and macros yourself.');
    }

    await db.insert(mealLogs).values({
      id: randomId('mealLog'), userId: principal.userId, date, slot: body.slot, ...payload,
    });

    await db.update(mealPlanEntries)
      .set({ status: 'logged', updatedAt: new Date() })
      .where(and(
        eq(mealPlanEntries.userId, principal.userId),
        eq(mealPlanEntries.date, date),
        eq(mealPlanEntries.slot, body.slot),
      ));

    return { ok: true };
  });

  app.post('/me/nutrition/swap', async (request) => {
    const principal = requireMember(request.principal);
    const body = parse(
      z.object({ date: isoDateSchema, slot: z.enum(MEAL_SLOTS), recipeSlug: z.string().max(80).optional() }),
      request.body,
    );
    const { db } = request.ctx;

    const [profile] = await db
      .select().from(memberProfiles).where(eq(memberProfiles.userId, principal.userId)).limit(1);
    const diet = (profile?.diet ?? 'balanced') as DietPreference;

    let replacement;
    if (body.recipeSlug) {
      [replacement] = await db.select().from(recipes).where(eq(recipes.slug, body.recipeSlug)).limit(1);
      if (!replacement) throw notFound('Recipe');
      if (!recipeMatchesDiet(replacement.tags, diet)) {
        throw badRequest('diet_mismatch', 'That recipe does not fit the diet preference on your profile.');
      }
    } else {
      const [current] = await db
        .select().from(mealPlanEntries)
        .where(and(
          eq(mealPlanEntries.userId, principal.userId),
          eq(mealPlanEntries.date, body.date),
          eq(mealPlanEntries.slot, body.slot),
        ))
        .limit(1);

      const candidates = (await db.select().from(recipes).where(eq(recipes.slot, body.slot)))
        .filter((recipe) => recipeMatchesDiet(recipe.tags, diet) && recipe.id !== current?.recipeId);
      replacement = candidates[0];
      if (!replacement) throw badRequest('no_alternative', 'No alternative recipe fits your diet for that slot.');
    }

    const existing = await db
      .select({ id: mealPlanEntries.id }).from(mealPlanEntries)
      .where(and(
        eq(mealPlanEntries.userId, principal.userId),
        eq(mealPlanEntries.date, body.date),
        eq(mealPlanEntries.slot, body.slot),
      ))
      .limit(1);

    if (existing[0]) {
      await db.update(mealPlanEntries)
        .set({ recipeId: replacement.id, status: 'planned', updatedAt: new Date() })
        .where(eq(mealPlanEntries.id, existing[0].id));
    } else {
      await db.insert(mealPlanEntries).values({
        id: randomId('meal'), userId: principal.userId, date: body.date,
        slot: body.slot, recipeId: replacement.id, status: 'planned',
      });
    }

    return { ok: true, recipe: replacement };
  });

  app.get('/me/nutrition/week', async (request) => {
    const principal = requireMember(request.principal);
    const query = parse(z.object({ weekStart: isoDateSchema.optional() }), request.query);
    const { db, today } = request.ctx;
    const weekStart = query.weekStart ?? startOfWeek(today());

    const entries = await db
      .select({ date: mealPlanEntries.date, slot: mealPlanEntries.slot, status: mealPlanEntries.status, recipe: recipes })
      .from(mealPlanEntries)
      .innerJoin(recipes, eq(recipes.id, mealPlanEntries.recipeId))
      .where(and(
        eq(mealPlanEntries.userId, principal.userId),
        gte(mealPlanEntries.date, weekStart),
        sql`${mealPlanEntries.date} <= ${addDays(weekStart, 6)}`,
      ))
      .orderBy(mealPlanEntries.date);

    return {
      weekStart,
      days: Array.from({ length: 7 }, (_, offset) => {
        const date = addDays(weekStart, offset);
        return { date, meals: entries.filter((entry) => entry.date === date) };
      }),
    };
  });

  app.get('/me/nutrition/shopping-list', async (request) => {
    const principal = requireMember(request.principal);
    const query = parse(z.object({ weekStart: isoDateSchema.optional() }), request.query);
    const { db, today } = request.ctx;
    const weekStart = query.weekStart ?? startOfWeek(today());

    const items = await db
      .select().from(shoppingListItems)
      .where(and(eq(shoppingListItems.userId, principal.userId), eq(shoppingListItems.weekStart, weekStart)))
      .orderBy(asc(shoppingListItems.section), asc(shoppingListItems.name));

    return {
      weekStart,
      items: items.map((item) => ({ ...item, quantity: item.quantityCenti / 100 })),
    };
  });

  app.post('/me/nutrition/shopping-list/generate', async (request) => {
    const principal = requireMember(request.principal);
    const body = parse(
      z.object({ weekStart: isoDateSchema.optional(), servings: z.number().int().min(1).max(8).default(1) }),
      request.body ?? {},
    );
    const { db, today } = request.ctx;
    const weekStart = body.weekStart ?? startOfWeek(today());

    const entries = await db
      .select({ recipeId: mealPlanEntries.recipeId, servings: recipes.servings })
      .from(mealPlanEntries)
      .innerJoin(recipes, eq(recipes.id, mealPlanEntries.recipeId))
      .where(and(
        eq(mealPlanEntries.userId, principal.userId),
        gte(mealPlanEntries.date, weekStart),
        sql`${mealPlanEntries.date} <= ${addDays(weekStart, 6)}`,
      ));

    if (entries.length === 0) {
      throw badRequest('no_meal_plan', 'Plan some meals for that week before generating a list.');
    }

    const ingredientRows = await db
      .select().from(recipeIngredients)
      .where(sql`${recipeIngredients.recipeId} in ${entries.map((e) => e.recipeId)}`);

    const byRecipe = new Map<string, RecipeIngredient[]>();
    for (const row of ingredientRows) {
      const list = byRecipe.get(row.recipeId) ?? [];
      list.push({
        name: row.name, quantity: row.quantityCenti / 100,
        unit: row.unit, section: row.section as ShoppingSection,
      });
      byRecipe.set(row.recipeId, list);
    }

    const list = buildShoppingList(
      entries.map((entry) => ({
        ingredients: byRecipe.get(entry.recipeId) ?? [],
        servings: entry.servings,
      })),
      body.servings,
    );

    // Regenerating replaces the week's list wholesale. Merging would silently
    // keep items for meals the member has since swapped out.
    await db.delete(shoppingListItems).where(and(
      eq(shoppingListItems.userId, principal.userId),
      eq(shoppingListItems.weekStart, weekStart),
    ));

    if (list.length > 0) {
      await db.insert(shoppingListItems).values(
        list.map((item) => ({
          id: randomId('meal'), userId: principal.userId, weekStart, name: item.name,
          quantityCenti: Math.round(item.quantity * 100), unit: item.unit,
          section: item.section, recipeCount: item.recipeCount, checked: false,
        })),
      );
    }

    return { ok: true, weekStart, items: list };
  });

  app.patch('/me/nutrition/shopping-list/:id', async (request) => {
    const principal = requireMember(request.principal);
    const { id } = parse(z.object({ id: z.string().max(40) }), request.params);
    const body = parse(z.object({ checked: z.boolean() }), request.body);
    const { db } = request.ctx;

    const result = await db
      .update(shoppingListItems)
      .set({ checked: body.checked, updatedAt: new Date() })
      .where(and(eq(shoppingListItems.id, id), eq(shoppingListItems.userId, principal.userId)))
      .returning();

    if (result.length === 0) throw notFound('List item');
    return { ok: true };
  });

  app.get('/me/nutrition/favourites', async (request) => {
    const principal = requireMember(request.principal);
    const { db } = request.ctx;
    return {
      favourites: await db
        .select({ recipe: recipes })
        .from(recipeFavourites)
        .innerJoin(recipes, eq(recipes.id, recipeFavourites.recipeId))
        .where(eq(recipeFavourites.userId, principal.userId)),
    };
  });

  app.post('/me/nutrition/favourites', async (request) => {
    const principal = requireMember(request.principal);
    const body = parse(z.object({ recipeSlug: z.string().max(80) }), request.body);
    const { db } = request.ctx;

    const [recipe] = await db.select().from(recipes).where(eq(recipes.slug, body.recipeSlug)).limit(1);
    if (!recipe) throw notFound('Recipe');

    const existing = await db
      .select({ id: recipeFavourites.id }).from(recipeFavourites)
      .where(and(eq(recipeFavourites.userId, principal.userId), eq(recipeFavourites.recipeId, recipe.id)))
      .limit(1);

    if (existing[0]) {
      await db.delete(recipeFavourites).where(eq(recipeFavourites.id, existing[0].id));
      return { ok: true, favourited: false };
    }
    await db.insert(recipeFavourites).values({
      id: randomId('meal'), userId: principal.userId, recipeId: recipe.id,
    });
    return { ok: true, favourited: true };
  });
}
