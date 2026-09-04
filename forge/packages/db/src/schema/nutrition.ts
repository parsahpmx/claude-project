import { sql } from 'drizzle-orm';
import {
  boolean, date, index, integer, pgTable, smallint, text, timestamp, uniqueIndex, varchar,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from './_shared.js';
import { users } from './identity.js';

export const recipes = pgTable(
  'recipes',
  {
    id: id().primaryKey(),
    slug: varchar('slug', { length: 80 }).notNull().unique(),
    name: varchar('name', { length: 140 }).notNull(),
    summary: text('summary').notNull(),
    slot: varchar('slot', { length: 16 }).notNull(),
    calories: integer('calories').notNull(),
    proteinGrams: smallint('protein_grams').notNull(),
    carbGrams: smallint('carb_grams').notNull(),
    fatGrams: smallint('fat_grams').notNull(),
    fibreGrams: smallint('fibre_grams').notNull().default(0),
    prepMinutes: smallint('prep_minutes').notNull(),
    cookMinutes: smallint('cook_minutes').notNull().default(0),
    difficulty: varchar('difficulty', { length: 16 }).notNull().default('easy'),
    servings: smallint('servings').notNull().default(1),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    instructions: text('instructions').array().notNull().default(sql`'{}'::text[]`),
    imageKey: varchar('image_key', { length: 64 }).notNull(),
    ...timestamps,
  },
  (table) => [index('recipes_slot_idx').on(table.slot)],
);

export const recipeIngredients = pgTable(
  'recipe_ingredients',
  {
    id: id().primaryKey(),
    recipeId: id('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    // Quantities are stored ×100 as integers, so 1.5 tbsp is 150 and no
    // shopping list ever shows "0.30000000000000004 kg".
    quantityCenti: integer('quantity_centi').notNull(),
    unit: varchar('unit', { length: 24 }).notNull(),
    section: varchar('section', { length: 16 }).notNull(),
    position: smallint('position').notNull().default(0),
  },
  (table) => [index('recipe_ingredients_recipe_idx').on(table.recipeId)],
);

export const nutritionTargets = pgTable('nutrition_targets', {
  userId: id('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  calories: integer('calories').notNull(),
  proteinGrams: smallint('protein_grams').notNull(),
  carbGrams: smallint('carb_grams').notNull(),
  fatGrams: smallint('fat_grams').notNull(),
  fibreGrams: smallint('fibre_grams').notNull(),
  waterMl: integer('water_ml').notNull(),
  ...timestamps,
});

export const mealPlanEntries = pgTable(
  'meal_plan_entries',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    slot: varchar('slot', { length: 16 }).notNull(),
    recipeId: id('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 }).notNull().default('planned'),
    ...timestamps,
  },
  (table) => [uniqueIndex('meal_plan_user_date_slot_unique').on(table.userId, table.date, table.slot)],
);

export const mealLogs = pgTable(
  'meal_logs',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    slot: varchar('slot', { length: 16 }).notNull(),
    name: varchar('name', { length: 140 }).notNull(),
    recipeId: id('recipe_id').references(() => recipes.id, { onDelete: 'set null' }),
    calories: integer('calories').notNull(),
    proteinGrams: smallint('protein_grams').notNull(),
    carbGrams: smallint('carb_grams').notNull(),
    fatGrams: smallint('fat_grams').notNull(),
    loggedAt: timestamp('logged_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index('meal_logs_user_date_idx').on(table.userId, table.date)],
);

export const recipeFavourites = pgTable(
  'recipe_favourites',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    recipeId: id('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [uniqueIndex('recipe_favourites_unique').on(table.userId, table.recipeId)],
);

export const shoppingListItems = pgTable(
  'shopping_list_items',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    weekStart: date('week_start').notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    quantityCenti: integer('quantity_centi').notNull(),
    unit: varchar('unit', { length: 24 }).notNull(),
    section: varchar('section', { length: 16 }).notNull(),
    recipeCount: smallint('recipe_count').notNull().default(1),
    checked: boolean('checked').notNull().default(false),
    ...timestamps,
  },
  (table) => [index('shopping_list_user_week_idx').on(table.userId, table.weekStart)],
);
