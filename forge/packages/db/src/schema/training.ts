import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { grams, id, timestamps } from './_shared.js';
import { users } from './identity.js';

/**
 * Training.
 *
 * The programme *catalogue* lives in `@forge/core` as code, because it is
 * editorial content that ships with a release. What lives here is what a
 * member did with it: their plan, the days in it, and every set they logged.
 */

export const plans = pgTable(
  'plans',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    programSlug: varchar('program_slug', { length: 64 }).notNull(),
    programName: varchar('program_name', { length: 120 }).notNull(),
    goal: varchar('goal', { length: 32 }).notNull(),
    startDate: date('start_date').notNull(),
    totalWeeks: smallint('total_weeks').notNull(),
    sessionsPerWeek: smallint('sessions_per_week').notNull(),
    sessionMinutes: smallint('session_minutes').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    phases: text('phases').notNull(),
    ...timestamps,
  },
  (table) => [index('plans_user_status_idx').on(table.userId, table.status)],
);

export const planWeeks = pgTable(
  'plan_weeks',
  {
    id: id().primaryKey(),
    planId: id('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
    weekNumber: smallint('week_number').notNull(),
    phase: varchar('phase', { length: 16 }).notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    deload: boolean('deload').notNull().default(false),
    nutritionGoal: varchar('nutrition_goal', { length: 160 }).notNull(),
    recoveryTarget: varchar('recovery_target', { length: 160 }).notNull(),
    coachCheckIn: boolean('coach_check_in').notNull().default(false),
    milestone: varchar('milestone', { length: 160 }),
    ...timestamps,
  },
  (table) => [uniqueIndex('plan_weeks_plan_week_unique').on(table.planId, table.weekNumber)],
);

export const planDays = pgTable(
  'plan_days',
  {
    id: id().primaryKey(),
    planWeekId: id('plan_week_id').notNull().references(() => planWeeks.id, { onDelete: 'cascade' }),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    dayOfWeek: smallint('day_of_week').notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    focus: varchar('focus', { length: 120 }).notNull(),
    minutes: smallint('minutes').notNull(),
    patterns: text('patterns').array().notNull().default(sql`'{}'::text[]`),
    sessionTemplate: text('session_template'),
    status: varchar('status', { length: 16 }).notNull().default('scheduled'),
    /** Set when a member moves a session; the original date is never lost. */
    rescheduledFrom: date('rescheduled_from'),
    ...timestamps,
  },
  (table) => [
    index('plan_days_user_date_idx').on(table.userId, table.date),
    index('plan_days_week_idx').on(table.planWeekId),
  ],
);

export const workoutLogs = pgTable(
  'workout_logs',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    planDayId: id('plan_day_id').references(() => planDays.id, { onDelete: 'set null' }),
    title: varchar('title', { length: 120 }).notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    date: date('date').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    volumeGrams: grams('volume_grams').notNull().default(0),
    calories: integer('calories').notNull().default(0),
    averageHeartRate: smallint('average_heart_rate'),
    maxHeartRate: smallint('max_heart_rate'),
    averageRpe: smallint('average_rpe'),
    sessionLoad: integer('session_load').notNull().default(0),
    difficultyFeedback: varchar('difficulty_feedback', { length: 16 }),
    muscleGroups: text('muscle_groups').array().notNull().default(sql`'{}'::text[]`),
    notes: text('notes'),
    ...timestamps,
  },
  (table) => [index('workout_logs_user_date_idx').on(table.userId, table.date)],
);

export const setLogs = pgTable(
  'set_logs',
  {
    id: id().primaryKey(),
    workoutLogId: id('workout_log_id').notNull().references(() => workoutLogs.id, { onDelete: 'cascade' }),
    exerciseId: varchar('exercise_id', { length: 64 }).notNull(),
    exerciseName: varchar('exercise_name', { length: 120 }).notNull(),
    setIndex: smallint('set_index').notNull(),
    reps: smallint('reps').notNull().default(0),
    loadGrams: grams('load_grams').notNull().default(0),
    rpe: smallint('rpe'),
    completed: boolean('completed').notNull().default(false),
    restSeconds: smallint('rest_seconds'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    uniqueIndex('set_logs_workout_exercise_set_unique').on(table.workoutLogId, table.exerciseId, table.setIndex),
    index('set_logs_exercise_idx').on(table.exerciseId),
  ],
);

/**
 * The member's current working load per movement.
 *
 * One row per member per exercise, updated by the progression engine after
 * every session. This is what makes "Previous: 95kg × 8" in the workout player
 * a fact rather than a guess.
 */
export const exerciseLoads = pgTable(
  'exercise_loads',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    exerciseId: varchar('exercise_id', { length: 64 }).notNull(),
    workingLoadGrams: grams('working_load_grams').notNull(),
    lastReps: smallint('last_reps'),
    lastRpe: smallint('last_rpe'),
    bestLoadGrams: grams('best_load_grams').notNull().default(0),
    bestEstimatedOneRepMax: grams('best_estimated_one_rep_max').notNull().default(0),
    ...timestamps,
  },
  (table) => [uniqueIndex('exercise_loads_user_exercise_unique').on(table.userId, table.exerciseId)],
);

export const personalRecords = pgTable(
  'personal_records',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    exerciseId: varchar('exercise_id', { length: 64 }).notNull(),
    exerciseName: varchar('exercise_name', { length: 120 }).notNull(),
    kind: varchar('kind', { length: 24 }).notNull(),
    valueGrams: grams('value_grams').notNull(),
    previousValueGrams: grams('previous_value_grams').notNull().default(0),
    reps: smallint('reps').notNull().default(1),
    achievedOn: date('achieved_on').notNull(),
    workoutLogId: id('workout_log_id').references(() => workoutLogs.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index('personal_records_user_exercise_idx').on(table.userId, table.exerciseId)],
);

export const bodyMeasurements = pgTable(
  'body_measurements',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    weightGrams: grams('weight_grams'),
    bodyFatPercent: smallint('body_fat_percent'),
    waistMm: integer('waist_mm'),
    chestMm: integer('chest_mm'),
    hipsMm: integer('hips_mm'),
    armMm: integer('arm_mm'),
    thighMm: integer('thigh_mm'),
    ...timestamps,
  },
  (table) => [uniqueIndex('body_measurements_user_date_unique').on(table.userId, table.date)],
);

export const recoverySessions = pgTable('recovery_sessions', {
  id: id().primaryKey(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  category: varchar('category', { length: 32 }).notNull(),
  minutes: smallint('minutes').notNull(),
  level: varchar('level', { length: 16 }).notNull().default('beginner'),
  description: text('description').notNull(),
  coachSlug: varchar('coach_slug', { length: 64 }),
  imageKey: varchar('image_key', { length: 64 }).notNull(),
  hasCaptions: boolean('has_captions').notNull().default(true),
  ...timestamps,
});

export const recoveryLogs = pgTable(
  'recovery_logs',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    recoverySessionId: id('recovery_session_id').references(() => recoverySessions.id, { onDelete: 'set null' }),
    date: date('date').notNull(),
    minutes: smallint('minutes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index('recovery_logs_user_date_idx').on(table.userId, table.date)],
);

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 24 }).notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    date: date('date').notNull(),
    startMinutes: smallint('start_minutes').notNull(),
    durationMinutes: smallint('duration_minutes').notNull(),
    referenceId: id('reference_id'),
    status: varchar('status', { length: 16 }).notNull().default('scheduled'),
    ...timestamps,
  },
  (table) => [index('calendar_events_user_date_idx').on(table.userId, table.date)],
);
