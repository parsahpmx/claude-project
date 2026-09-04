import { sql } from 'drizzle-orm';
import {
  boolean, date, index, integer, pgTable, smallint, text, timestamp, uniqueIndex, varchar,
} from 'drizzle-orm/pg-core';
import { cents, grams, id, timestamps } from './_shared.js';
import { users } from './identity.js';

export const coaches = pgTable(
  'coaches',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    slug: varchar('slug', { length: 64 }).notNull().unique(),
    headline: varchar('headline', { length: 140 }).notNull(),
    bio: text('bio').notNull(),
    philosophy: text('philosophy').notNull(),
    specialties: text('specialties').array().notNull().default(sql`'{}'::text[]`),
    languages: text('languages').array().notNull().default(sql`'{}'::text[]`),
    certifications: text('certifications').array().notNull().default(sql`'{}'::text[]`),
    yearsExperience: smallint('years_experience').notNull(),
    // Rating is stored ×10 as an integer. 4.9 is 49 — no float ever rounds a
    // coach's rating up on one screen and down on another.
    ratingTenths: smallint('rating_tenths').notNull().default(0),
    reviewCount: integer('review_count').notNull().default(0),
    clientCount: integer('client_count').notNull().default(0),
    clientCap: smallint('client_cap').notNull().default(40),
    availableSlotsThisWeek: smallint('available_slots_this_week').notNull().default(0),
    acceptingClients: boolean('accepting_clients').notNull().default(true),
    monthlyPriceCents: cents('monthly_price_cents').notNull(),
    consultationPriceCents: cents('consultation_price_cents').notNull(),
    sessionPriceCents: cents('session_price_cents').notNull(),
    imageKey: varchar('image_key', { length: 64 }).notNull(),
    ...timestamps,
  },
  (table) => [index('coaches_accepting_idx').on(table.acceptingClients)],
);

export const coachClients = pgTable(
  'coach_clients',
  {
    id: id().primaryKey(),
    coachId: id('coach_id').notNull().references(() => coaches.id, { onDelete: 'cascade' }),
    memberId: id('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    startedOn: date('started_on').notNull(),
    endedOn: date('ended_on'),
    ...timestamps,
  },
  (table) => [uniqueIndex('coach_clients_unique').on(table.coachId, table.memberId)],
);

export const coachReviews = pgTable(
  'coach_reviews',
  {
    id: id().primaryKey(),
    coachId: id('coach_id').notNull().references(() => coaches.id, { onDelete: 'cascade' }),
    memberId: id('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    rating: smallint('rating').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [uniqueIndex('coach_reviews_unique').on(table.coachId, table.memberId)],
);

export const bookings = pgTable(
  'bookings',
  {
    id: id().primaryKey(),
    coachId: id('coach_id').notNull().references(() => coaches.id, { onDelete: 'cascade' }),
    memberId: id('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 32 }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    durationMinutes: smallint('duration_minutes').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('confirmed'),
    priceCents: cents('price_cents').notNull().default(0),
    agenda: text('agenda'),
    ...timestamps,
  },
  (table) => [index('bookings_coach_start_idx').on(table.coachId, table.startsAt)],
);

export const checkIns = pgTable(
  'check_ins',
  {
    id: id().primaryKey(),
    memberId: id('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    coachId: id('coach_id').references(() => coaches.id, { onDelete: 'set null' }),
    weekStart: date('week_start').notNull(),
    energy: smallint('energy').notNull(),
    sleepQuality: smallint('sleep_quality').notNull(),
    stress: smallint('stress').notNull(),
    nutritionAdherence: smallint('nutrition_adherence').notNull(),
    trainingAdherence: smallint('training_adherence').notNull(),
    weightGrams: grams('weight_grams'),
    painNotes: text('pain_notes'),
    questions: text('questions'),
    progressPhotoCount: smallint('progress_photo_count').notNull().default(0),
    score: smallint('score').notNull(),
    band: varchar('band', { length: 16 }).notNull(),
    flags: text('flags').array().notNull().default(sql`'{}'::text[]`),
    coachResponse: text('coach_response'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [uniqueIndex('check_ins_member_week_unique').on(table.memberId, table.weekStart)],
);

export const messageThreads = pgTable(
  'message_threads',
  {
    id: id().primaryKey(),
    memberId: id('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    coachId: id('coach_id').notNull().references(() => coaches.id, { onDelete: 'cascade' }),
    subject: varchar('subject', { length: 160 }).notNull().default('Coaching'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().default(sql`now()`),
    ...timestamps,
  },
  (table) => [uniqueIndex('message_threads_unique').on(table.memberId, table.coachId)],
);

export const messages = pgTable(
  'messages',
  {
    id: id().primaryKey(),
    threadId: id('thread_id').notNull().references(() => messageThreads.id, { onDelete: 'cascade' }),
    senderId: id('sender_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 16 }).notNull().default('text'),
    body: text('body'),
    mediaKey: varchar('media_key', { length: 120 }),
    durationSeconds: smallint('duration_seconds'),
    exerciseId: varchar('exercise_id', { length: 64 }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index('messages_thread_created_idx').on(table.threadId, table.createdAt)],
);

/** Timestamped coach feedback pinned to a point in a form-check video. */
export const formCheckComments = pgTable(
  'form_check_comments',
  {
    id: id().primaryKey(),
    messageId: id('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
    authorId: id('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    timestampSeconds: smallint('timestamp_seconds').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index('form_check_comments_message_idx').on(table.messageId, table.timestampSeconds)],
);

export const coachNotes = pgTable(
  'coach_notes',
  {
    id: id().primaryKey(),
    coachId: id('coach_id').notNull().references(() => coaches.id, { onDelete: 'cascade' }),
    memberId: id('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    /** Private notes are never returned on a member-facing endpoint. */
    visibility: varchar('visibility', { length: 16 }).notNull().default('private'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index('coach_notes_coach_member_idx').on(table.coachId, table.memberId)],
);

export const coachApplications = pgTable('coach_applications', {
  id: id().primaryKey(),
  fullName: varchar('full_name', { length: 160 }).notNull(),
  email: varchar('email', { length: 320 }).notNull(),
  certifications: text('certifications').notNull(),
  yearsExperience: smallint('years_experience').notNull(),
  specialties: text('specialties').array().notNull().default(sql`'{}'::text[]`),
  about: text('about').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('submitted'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
});

export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: id().primaryKey(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    intent: varchar('intent', { length: 32 }).notNull(),
    answer: text('answer').notNull(),
    sources: text('sources').array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index('ai_conversations_user_idx').on(table.userId, table.createdAt)],
);
