import { sql } from 'drizzle-orm';
import {
  boolean, date, index, integer, pgTable, smallint, text, timestamp, uniqueIndex, varchar,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from './_shared.js';
import { users } from './identity.js';
import { workoutLogs } from './training.js';

export const groups = pgTable('groups', {
  id: id().primaryKey(),
  slug: varchar('slug', { length: 48 }).notNull().unique(),
  name: varchar('name', { length: 80 }).notNull(),
  description: text('description').notNull(),
  memberCount: integer('member_count').notNull().default(0),
  imageKey: varchar('image_key', { length: 64 }).notNull(),
  ...timestamps,
});

export const posts = pgTable(
  'posts',
  {
    id: id().primaryKey(),
    authorId: id('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    groupSlug: varchar('group_slug', { length: 48 }).references(() => groups.slug, { onDelete: 'set null' }),
    kind: varchar('kind', { length: 24 }).notNull().default('update'),
    body: text('body').notNull(),
    mediaKey: varchar('media_key', { length: 120 }),
    workoutLogId: id('workout_log_id').references(() => workoutLogs.id, { onDelete: 'set null' }),
    likeCount: integer('like_count').notNull().default(0),
    commentCount: integer('comment_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index('posts_group_created_idx').on(table.groupSlug, table.createdAt)],
);

export const postLikes = pgTable(
  'post_likes',
  {
    id: id().primaryKey(),
    postId: id('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  // One like per member per post, enforced by the database rather than by a
  // read-then-write that two taps can race through.
  (table) => [uniqueIndex('post_likes_unique').on(table.postId, table.userId)],
);

export const postComments = pgTable(
  'post_comments',
  {
    id: id().primaryKey(),
    postId: id('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
    authorId: id('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index('post_comments_post_idx').on(table.postId, table.createdAt)],
);

export const postSaves = pgTable(
  'post_saves',
  {
    id: id().primaryKey(),
    postId: id('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [uniqueIndex('post_saves_unique').on(table.postId, table.userId)],
);

export const follows = pgTable(
  'follows',
  {
    id: id().primaryKey(),
    followerId: id('follower_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    followeeId: id('followee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [uniqueIndex('follows_unique').on(table.followerId, table.followeeId)],
);

export const challengeParticipants = pgTable(
  'challenge_participants',
  {
    id: id().primaryKey(),
    challengeSlug: varchar('challenge_slug', { length: 64 }).notNull(),
    userId: id('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    value: integer('value').notNull().default(0),
    startedOn: date('started_on').notNull(),
    /** Members can take part without appearing on the public board. */
    visible: boolean('visible').notNull().default(true),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('challenge_participants_unique').on(table.challengeSlug, table.userId),
    index('challenge_participants_board_idx').on(table.challengeSlug, table.value),
  ],
);

export const articles = pgTable(
  'articles',
  {
    id: id().primaryKey(),
    slug: varchar('slug', { length: 100 }).notNull().unique(),
    title: varchar('title', { length: 200 }).notNull(),
    category: varchar('category', { length: 32 }).notNull(),
    excerpt: text('excerpt').notNull(),
    body: text('body').notNull(),
    authorName: varchar('author_name', { length: 120 }).notNull(),
    authorRole: varchar('author_role', { length: 120 }).notNull(),
    readMinutes: smallint('read_minutes').notNull(),
    featured: boolean('featured').notNull().default(false),
    imageKey: varchar('image_key', { length: 64 }).notNull(),
    publishedOn: date('published_on').notNull(),
    ...timestamps,
  },
  (table) => [index('articles_category_idx').on(table.category, table.publishedOn)],
);

export const successStories = pgTable('success_stories', {
  id: id().primaryKey(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  memberName: varchar('member_name', { length: 80 }).notNull(),
  headline: varchar('headline', { length: 200 }).notNull(),
  startingGoal: varchar('starting_goal', { length: 140 }).notNull(),
  programSlug: varchar('program_slug', { length: 64 }).notNull(),
  programName: varchar('program_name', { length: 120 }).notNull(),
  timePeriod: varchar('time_period', { length: 60 }).notNull(),
  consistency: varchar('consistency', { length: 60 }).notNull(),
  coachSlug: varchar('coach_slug', { length: 64 }),
  story: text('story').notNull(),
  /** Process outcomes only — no before/after weight claims. */
  outcomes: text('outcomes').array().notNull().default(sql`'{}'::text[]`),
  imageKey: varchar('image_key', { length: 64 }).notNull(),
  ...timestamps,
});
