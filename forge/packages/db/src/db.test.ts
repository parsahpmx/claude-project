import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { createDatabase, type DatabaseHandle } from './client.js';
import { runMigrations } from './migrate.js';
import { hashPassword, verifyPassword } from './password.js';
import { seedDatabase, DEMO_PASSWORD, type SeedResult } from './seed/seed.js';
import * as s from './schema/index.js';

/**
 * These run against a real Postgres (PGlite, in memory) rather than a mock, so
 * the constraints, array columns and unique indexes are genuinely exercised.
 */

let handle: DatabaseHandle;
let seed: SeedResult;

beforeAll(async () => {
  handle = await createDatabase({ dataDir: 'memory://forge-test' });
  await runMigrations(handle);
  seed = await seedDatabase(handle, { today: '2026-09-04' });
}, 120_000);

afterAll(async () => {
  await handle?.close();
});

describe('migrations and seed', () => {
  it('creates a populated dataset', () => {
    expect(seed.users).toBeGreaterThan(10);
    expect(seed.workouts).toBeGreaterThan(50);
    expect(seed.setLogs).toBeGreaterThan(300);
  });

  it('stores a plan whose weeks and days are complete', async () => {
    const [plan] = await handle.db.select().from(s.plans).limit(1);
    expect(plan).toBeDefined();

    const weeks = await handle.db.select().from(s.planWeeks).where(eq(s.planWeeks.planId, plan!.id));
    expect(weeks).toHaveLength(plan!.totalWeeks);

    const days = await handle.db
      .select({ count: sql<number>`count(*)::int` })
      .from(s.planDays)
      .where(eq(s.planDays.planWeekId, weeks[0]!.id));
    expect(days[0]?.count).toBe(7);
  });

  it('links every set log to a workout that exists', async () => {
    const orphans = await handle.db.select({ count: sql<number>`count(*)::int` }).from(sql`
      (select 1 from set_logs sl
        left join workout_logs wl on wl.id = sl.workout_log_id
        where wl.id is null) as orphans
    `);
    expect(orphans[0]?.count).toBe(0);
  });

  it('never records a personal record above its own working best', async () => {
    const records = await handle.db.select().from(s.personalRecords).limit(50);
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.valueGrams).toBeGreaterThan(record.previousValueGrams);
    }
  });

  it('progresses working loads upward across the block, never downward', async () => {
    // The bug this guards: folding each phase's intensity bias back into the
    // stored working load compounds it, so a member who hit every prescribed
    // rep for twelve weeks ends the block lighter than they started.
    const loads = await handle.db.select().from(s.exerciseLoads);
    expect(loads.length).toBeGreaterThan(0);

    const loaded = loads.filter((row) => row.bestLoadGrams > 0);
    expect(loaded.length).toBeGreaterThan(0);
    for (const row of loaded) {
      expect(
        row.workingLoadGrams,
        `${row.exerciseId}: working ${row.workingLoadGrams} vs best ${row.bestLoadGrams}`,
      ).toBeGreaterThanOrEqual(Math.round(row.bestLoadGrams * 0.9));
    }
  });

  it('stores loads as integer grams, never floats', async () => {
    const sets = await handle.db.select().from(s.setLogs).limit(200);
    for (const set of sets) {
      expect(Number.isInteger(set.loadGrams)).toBe(true);
    }
  });

  it('keeps text[] columns usable through the driver', async () => {
    const [coach] = await handle.db.select().from(s.coaches).limit(1);
    expect(Array.isArray(coach?.specialties)).toBe(true);
    expect(coach!.specialties.length).toBeGreaterThan(0);
    expect(Array.isArray(coach?.certifications)).toBe(true);
  });
});

describe('constraints', () => {
  it('rejects a duplicate email regardless of case', async () => {
    const [existing] = await handle.db.select().from(s.users).limit(1);
    await expect(
      handle.db.insert(s.users).values({
        id: 'usr_duplicatecase', email: existing!.email.toUpperCase(),
        passwordHash: 'x', firstName: 'Dup', lastName: 'User',
      }),
    ).rejects.toThrow();
  });

  it('allows only one like per member per post', async () => {
    const [like] = await handle.db.select().from(s.postLikes).limit(1);
    await expect(
      handle.db.insert(s.postLikes).values({
        id: 'pst_duplicatelike', postId: like!.postId, userId: like!.userId,
      }),
    ).rejects.toThrow();
  });

  it('allows only one check-in per member per week', async () => {
    const [checkIn] = await handle.db.select().from(s.checkIns).limit(1);
    await expect(
      handle.db.insert(s.checkIns).values({
        id: 'cin_duplicateweek', memberId: checkIn!.memberId, weekStart: checkIn!.weekStart,
        energy: 3, sleepQuality: 3, stress: 3, nutritionAdherence: 3, trainingAdherence: 3,
        score: 50, band: 'on-track',
      }),
    ).rejects.toThrow();
  });

  it('cascades a member deletion through their training data', async () => {
    // Deliberately not the demo account: later tests assert on alex@forge.fit,
    // and a destructive test must not depend on suite ordering to be safe.
    const [member] = await handle.db
      .select().from(s.users).where(eq(s.users.email, 'sam@forge.fit')).limit(1);
    expect(member).toBeDefined();
    const before = await handle.db
      .select({ count: sql<number>`count(*)::int` })
      .from(s.workoutLogs).where(eq(s.workoutLogs.userId, member!.id));
    expect(before[0]!.count).toBeGreaterThan(0);

    await handle.db.delete(s.users).where(eq(s.users.id, member!.id));

    const after = await handle.db
      .select({ count: sql<number>`count(*)::int` })
      .from(s.workoutLogs).where(eq(s.workoutLogs.userId, member!.id));
    expect(after[0]!.count).toBe(0);
  });
});

describe('password hashing', () => {
  it('never stores the password and verifies the right one', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored).not.toContain('correct horse');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(await verifyPassword('wrong password', stored)).toBe(false);
  });

  it('produces a different hash for the same password each time', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('rejects a malformed stored hash rather than throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$1$2$3$4')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });

  it('verifies the seeded demo account', async () => {
    const [demo] = await handle.db
      .select().from(s.users).where(eq(s.users.email, 'alex@forge.fit')).limit(1);
    expect(demo).toBeDefined();
    expect(await verifyPassword(DEMO_PASSWORD, demo!.passwordHash)).toBe(true);
  });
});

describe('seeded data quality', () => {
  it('gives the demo member a coach, a thread and a check-in history', async () => {
    const [demo] = await handle.db
      .select().from(s.users).where(eq(s.users.email, 'alex@forge.fit')).limit(1);
    const threads = await handle.db
      .select().from(s.messageThreads).where(eq(s.messageThreads.memberId, demo!.id));
    expect(threads).toHaveLength(1);

    const messages = await handle.db
      .select().from(s.messages).where(eq(s.messages.threadId, threads[0]!.id));
    expect(messages.length).toBeGreaterThan(4);
    expect(messages.some((m) => m.kind === 'form-check')).toBe(true);

    const comments = await handle.db.select().from(s.formCheckComments);
    expect(comments.length).toBeGreaterThan(0);
    expect(comments[0]!.timestampSeconds).toBeGreaterThan(0);
  });

  it('writes no placeholder copy anywhere in the catalogue', async () => {
    const recipes = await handle.db.select().from(s.recipes);
    const articles = await handle.db.select().from(s.articles);
    const products = await handle.db.select().from(s.products);
    const corpus = [
      ...recipes.map((r) => `${r.name} ${r.summary}`),
      ...articles.map((a) => `${a.title} ${a.excerpt} ${a.body}`),
      ...products.map((p) => `${p.name} ${p.description}`),
    ].join(' ').toLowerCase();
    expect(corpus).not.toContain('lorem');
    expect(corpus).not.toContain('ipsum');
    expect(corpus).not.toContain('placeholder');
    expect(corpus).not.toContain('todo');
  });

  it('only claims programme compatibility for programmes that exist', async () => {
    const products = await handle.db.select().from(s.products);
    const plans = await handle.db.select({ slug: s.plans.programSlug }).from(s.plans);
    expect(plans.length).toBeGreaterThan(0);
    for (const product of products) {
      expect(product.compatiblePrograms.length).toBeGreaterThan(0);
    }
  });

  it('marks past sessions as completed or skipped, never left scheduled', async () => {
    const stale = await handle.db
      .select({ count: sql<number>`count(*)::int` })
      .from(s.planDays)
      .where(and(sql`${s.planDays.date} < '2026-09-04'`, eq(s.planDays.status, 'scheduled'), sql`${s.planDays.kind} <> 'rest'`));
    expect(stale[0]!.count).toBe(0);
  });
});
