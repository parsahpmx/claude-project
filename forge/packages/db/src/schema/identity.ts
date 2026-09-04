import { relations, sql } from 'drizzle-orm';
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
import { id, timestamps } from './_shared.js';

export const users = pgTable(
  'users',
  {
    id: id().primaryKey(),
    email: varchar('email', { length: 320 }).notNull(),
    // scrypt, `N$r$p$salt$hash`. Never a plaintext or reversible column.
    passwordHash: text('password_hash').notNull(),
    firstName: varchar('first_name', { length: 80 }).notNull(),
    lastName: varchar('last_name', { length: 80 }).notNull(),
    role: varchar('role', { length: 16 }).notNull().default('member'),
    avatarKey: varchar('avatar_key', { length: 120 }),
    timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
    unitSystem: varchar('unit_system', { length: 10 }).notNull().default('metric'),
    locale: varchar('locale', { length: 10 }).notNull().default('en-GB'),
    marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    // Case-insensitive uniqueness: "Alex@forge.fit" and "alex@forge.fit" are
    // one person, and letting both register is a support problem forever.
    uniqueIndex('users_email_unique').on(sql`lower(${table.email})`),
  ],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // Only the hash is stored. A database dump must not hand out live sessions.
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: varchar('user_agent', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    uniqueIndex('auth_sessions_token_hash_unique').on(table.tokenHash),
    index('auth_sessions_user_idx').on(table.userId),
  ],
);

export const memberProfiles = pgTable('member_profiles', {
  userId: id('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  primaryGoal: varchar('primary_goal', { length: 32 }).notNull(),
  secondaryGoals: text('secondary_goals').array().notNull().default(sql`'{}'::text[]`),
  ageRange: varchar('age_range', { length: 10 }).notNull(),
  experience: varchar('experience', { length: 16 }).notNull(),
  daysPerWeek: smallint('days_per_week').notNull(),
  sessionMinutes: smallint('session_minutes').notNull(),
  trainingLocation: varchar('training_location', { length: 16 }).notNull(),
  equipment: text('equipment').array().notNull().default(sql`'{}'::text[]`),
  diet: varchar('diet', { length: 24 }).notNull(),
  coachingPreference: varchar('coaching_preference', { length: 24 }).notNull(),
  heightCm: integer('height_cm'),
  weightKg: integer('weight_kg'),
  sexAtBirth: varchar('sex_at_birth', { length: 24 }),
  // Rolling personal baselines for readiness. Population defaults until the
  // member has enough history for their own numbers to mean something.
  baselineSleepMinutes: integer('baseline_sleep_minutes').notNull().default(450),
  baselineHrvMs: integer('baseline_hrv_ms').notNull().default(62),
  baselineRestingHeartRate: integer('baseline_resting_heart_rate').notNull().default(58),
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
  ...timestamps,
});

export const assessments = pgTable(
  'assessments',
  {
    id: id().primaryKey(),
    userId: id('user_id').references(() => users.id, { onDelete: 'cascade' }),
    // Anonymous assessments are kept so the funnel can be resumed after signup.
    anonymousKey: varchar('anonymous_key', { length: 64 }),
    answers: text('answers').notNull(),
    profile: text('profile').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('assessments_user_idx').on(table.userId)],
);

export const devices = pgTable(
  'devices',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 32 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('not-connected'),
    permissions: text('permissions').array().notNull().default(sql`'{}'::text[]`),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex('devices_user_provider_unique').on(table.userId, table.provider)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 32 }).notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    body: text('body').notNull(),
    href: varchar('href', { length: 255 }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index('notifications_user_idx').on(table.userId, table.createdAt)],
);

export const dailyMetrics = pgTable(
  'daily_metrics',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    sleepMinutes: integer('sleep_minutes'),
    hrvMs: integer('hrv_ms'),
    restingHeartRate: integer('resting_heart_rate'),
    steps: integer('steps'),
    waterMl: integer('water_ml'),
    soreness: smallint('soreness'),
    stress: smallint('stress'),
    readinessScore: smallint('readiness_score'),
    recoveryScore: smallint('recovery_score'),
    source: varchar('source', { length: 32 }).notNull().default('manual'),
    ...timestamps,
  },
  (table) => [uniqueIndex('daily_metrics_user_date_unique').on(table.userId, table.date)],
);

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(memberProfiles, { fields: [users.id], references: [memberProfiles.userId] }),
  sessions: many(authSessions),
  devices: many(devices),
  metrics: many(dailyMetrics),
}));
