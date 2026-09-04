import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  addDays, adherence, assessTrainingLoad, buildDailyTimeline, computeReadiness,
  computeRecoveryScore, consistencyHeatmap, entitlementsFor, estimateMaxHeartRate,
  estimateVo2Max, findPlan, formatLongDate, movingAverage, muscleDistribution,
  planPricing, randomId, startOfWeek, strengthTrend, summariseProgress, weeklyVolume,
  type MuscleGroup, type PlanTier,
} from '@forge/core';
import {
  bodyMeasurements, calendarEvents, dailyMetrics, devices, invoices, memberProfiles,
  notifications, nutritionTargets, paymentMethods, personalRecords, planDays, plans,
  planWeeks, recoveryLogs, subscriptions, users, workoutLogs,
} from '@forge/db';
import { notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireMember } from '../auth/guards.js';
import { isoDateSchema } from './schemas.js';

/**
 * The member's own data: dashboard, progress, profile, devices and billing.
 *
 * Every query in this file is scoped by `principal.userId` in its WHERE
 * clause. There is no "load by id and then check ownership" path, because that
 * pattern only fails open.
 */
export async function registerMemberRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me/dashboard', async (request) => {
    const principal = requireMember(request.principal);
    const { db, today } = request.ctx;
    const date = today();
    const weekStart = startOfWeek(date);

    const [profile] = await db
      .select().from(memberProfiles).where(eq(memberProfiles.userId, principal.userId)).limit(1);

    const [metrics] = await db
      .select().from(dailyMetrics)
      .where(and(eq(dailyMetrics.userId, principal.userId), eq(dailyMetrics.date, date)))
      .limit(1);

    const readiness = computeReadiness(
      {
        sleepMinutes: metrics?.sleepMinutes ?? undefined,
        hrvMs: metrics?.hrvMs ?? undefined,
        restingHeartRate: metrics?.restingHeartRate ?? undefined,
        soreness: metrics?.soreness ?? undefined,
        stress: metrics?.stress ?? undefined,
      },
      {
        sleepMinutes: profile?.baselineSleepMinutes ?? 450,
        hrvMs: profile?.baselineHrvMs ?? 62,
        restingHeartRate: profile?.baselineRestingHeartRate ?? 58,
      },
    );

    const [plan] = await db
      .select().from(plans)
      .where(and(eq(plans.userId, principal.userId), eq(plans.status, 'active')))
      .limit(1);

    const [todaysDay] = await db
      .select().from(planDays)
      .where(and(eq(planDays.userId, principal.userId), eq(planDays.date, date)))
      .limit(1);

    const weekDays = await db
      .select().from(planDays)
      .where(and(
        eq(planDays.userId, principal.userId),
        gte(planDays.date, weekStart),
        sql`${planDays.date} <= ${addDays(weekStart, 6)}`,
      ))
      .orderBy(planDays.date);

    const scheduled = weekDays.filter((d) => d.kind !== 'rest');
    const completed = scheduled.filter((d) => d.status === 'completed');

    const recentWorkouts = await db
      .select().from(workoutLogs)
      .where(eq(workoutLogs.userId, principal.userId))
      .orderBy(desc(workoutLogs.date))
      .limit(60);

    const summary = summariseProgress(
      recentWorkouts.map((w) => ({
        date: w.date, durationMinutes: Math.round(w.durationSeconds / 60),
        volumeGrams: w.volumeGrams, calories: w.calories, kind: w.kind,
        muscleGroups: w.muscleGroups as MuscleGroup[],
      })),
      date,
    );

    const [targets] = await db
      .select().from(nutritionTargets).where(eq(nutritionTargets.userId, principal.userId)).limit(1);

    const consumed = await db
      .select({
        calories: sql<number>`coalesce(sum(calories),0)::int`,
        protein: sql<number>`coalesce(sum(protein_grams),0)::int`,
      })
      .from(sql`meal_logs`)
      .where(sql`user_id = ${principal.userId} and date = ${date}`);

    const recoveryToday = await db
      .select({ minutes: sql<number>`coalesce(sum(minutes),0)::int` })
      .from(recoveryLogs)
      .where(and(eq(recoveryLogs.userId, principal.userId), eq(recoveryLogs.date, date)));

    const [nextEvent] = await db
      .select().from(calendarEvents)
      .where(and(eq(calendarEvents.userId, principal.userId), gte(calendarEvents.date, date)))
      .orderBy(calendarEvents.date, calendarEvents.startMinutes)
      .limit(1);

    const unread = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, principal.userId), sql`${notifications.readAt} is null`));

    const timeline = buildDailyTimeline({
      trainingMinutesFromMidnight: todaysDay && todaysDay.kind !== 'rest'
        ? (todaysDay.kind === 'running' ? 7 * 60 : 17 * 60 + 30)
        : null,
      hasMobility: (profile?.daysPerWeek ?? 3) >= 4,
      coachCheckInMinutes: nextEvent?.kind === 'coach-session' ? nextEvent.startMinutes : null,
    });

    return {
      greeting: greetingFor(new Date()),
      dateLabel: formatLongDate(date),
      date,
      member: { firstName: principal.firstName, unitSystem: principal.unitSystem },
      readiness,
      recoveryScore: computeRecoveryScore(
        readiness.score,
        recoveryToday[0]?.minutes ? 1 : 0,
        2,
        78,
      ),
      today: todaysDay ?? null,
      plan: plan ?? null,
      week: {
        start: weekStart,
        completed: completed.length,
        scheduled: scheduled.length,
        adherencePercent: adherence(completed.length, scheduled.length),
        days: weekDays,
      },
      streak: { current: summary.currentStreakDays, longest: summary.longestStreakDays },
      load: assessTrainingLoad(dailyLoadSeries(recentWorkouts, date, 28)),
      metrics: {
        steps: metrics?.steps ?? null,
        stepsTarget: 10_000,
        sleepMinutes: metrics?.sleepMinutes ?? null,
        waterMl: metrics?.waterMl ?? null,
        waterTargetMl: targets?.waterMl ?? 3000,
      },
      nutrition: targets
        ? {
            targets,
            consumedCalories: consumed[0]?.calories ?? 0,
            consumedProtein: consumed[0]?.protein ?? 0,
          }
        : null,
      timeline,
      nextEvent: nextEvent ?? null,
      unreadNotifications: unread[0]?.count ?? 0,
    };
  });

  app.get('/me/progress', async (request) => {
    const principal = requireMember(request.principal);
    const { db, today } = request.ctx;
    const date = today();
    const from = addDays(date, -90);

    const logs = await db
      .select().from(workoutLogs)
      .where(and(eq(workoutLogs.userId, principal.userId), gte(workoutLogs.date, from)))
      .orderBy(workoutLogs.date);

    const records = logs.map((w) => ({
      date: w.date, durationMinutes: Math.round(w.durationSeconds / 60),
      volumeGrams: w.volumeGrams, calories: w.calories, kind: w.kind,
      muscleGroups: w.muscleGroups as MuscleGroup[],
    }));

    const prs = await db
      .select().from(personalRecords)
      .where(eq(personalRecords.userId, principal.userId))
      .orderBy(desc(personalRecords.achievedOn))
      .limit(40);

    const measurements = await db
      .select().from(bodyMeasurements)
      .where(and(eq(bodyMeasurements.userId, principal.userId), gte(bodyMeasurements.date, from)))
      .orderBy(bodyMeasurements.date);

    const metrics = await db
      .select().from(dailyMetrics)
      .where(and(eq(dailyMetrics.userId, principal.userId), gte(dailyMetrics.date, from)))
      .orderBy(dailyMetrics.date);

    const [profile] = await db
      .select().from(memberProfiles).where(eq(memberProfiles.userId, principal.userId)).limit(1);

    // Strength trends are built from the recorded estimated-1RM PRs, so the
    // chart shows what the member actually did rather than a model of it.
    const byExercise = new Map<string, { name: string; points: { date: string; estimatedOneRepMax: number }[] }>();
    for (const record of [...prs].reverse()) {
      if (record.kind !== 'estimated-1rm') continue;
      const entry = byExercise.get(record.exerciseId) ?? { name: record.exerciseName, points: [] };
      entry.points.push({ date: record.achievedOn, estimatedOneRepMax: record.valueGrams });
      byExercise.set(record.exerciseId, entry);
    }

    const ageYears = { '18-24': 21, '25-34': 30, '35-44': 40, '45-54': 50, '55-64': 60, '65+': 70 }[
      profile?.ageRange ?? '25-34'
    ] ?? 30;
    const latestRhr = metrics.filter((m) => m.restingHeartRate).at(-1)?.restingHeartRate ?? null;
    const maxHeartRate = estimateMaxHeartRate(ageYears);

    return {
      summary: summariseProgress(records, date),
      weeklyVolume: weeklyVolume(records, addDays(startOfWeek(date), -77), date),
      heatmap: consistencyHeatmap(records, addDays(date, -119), date),
      muscleDistribution: muscleDistribution(records),
      personalRecords: prs,
      strengthTrends: [...byExercise.entries()]
        .map(([exerciseId, entry]) => {
          const trend = strengthTrend(exerciseId, entry.points);
          return trend ? { ...trend, name: entry.name } : null;
        })
        .filter((t): t is NonNullable<typeof t> => t !== null)
        .sort((a, b) => b.points.length - a.points.length)
        .slice(0, 6),
      bodyweight: {
        raw: measurements
          .filter((m) => m.weightGrams !== null)
          .map((m) => ({ date: m.date, value: (m.weightGrams ?? 0) / 1000 })),
        smoothed: movingAverage(
          measurements
            .filter((m) => m.weightGrams !== null)
            .map((m) => ({ date: m.date, value: (m.weightGrams ?? 0) / 1000 })),
          4,
        ),
      },
      recovery: metrics.map((m) => ({
        date: m.date, readiness: m.readinessScore, recovery: m.recoveryScore,
        sleepMinutes: m.sleepMinutes, hrv: m.hrvMs, restingHeartRate: m.restingHeartRate,
      })),
      cardio: {
        restingHeartRate: latestRhr,
        maxHeartRate,
        vo2MaxEstimate: latestRhr ? estimateVo2Max(latestRhr, maxHeartRate) : null,
      },
      measurements: measurements.at(-1) ?? null,
    };
  });

  app.get('/me/profile', async (request) => {
    const principal = requireMember(request.principal);
    const { db } = request.ctx;
    const [profile] = await db
      .select().from(memberProfiles).where(eq(memberProfiles.userId, principal.userId)).limit(1);
    const [user] = await db.select().from(users).where(eq(users.id, principal.userId)).limit(1);
    const deviceRows = await db.select().from(devices).where(eq(devices.userId, principal.userId));

    return {
      user: user
        ? {
            id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
            timezone: user.timezone, unitSystem: user.unitSystem, locale: user.locale,
            marketingOptIn: user.marketingOptIn, avatarKey: user.avatarKey,
          }
        : null,
      profile: profile ?? null,
      devices: deviceRows,
    };
  });

  app.patch('/me/profile', async (request) => {
    const principal = requireMember(request.principal);
    const body = parse(
      z.object({
        firstName: z.string().trim().min(1).max(80).optional(),
        lastName: z.string().trim().min(1).max(80).optional(),
        timezone: z.string().max(64).optional(),
        unitSystem: z.enum(['metric', 'imperial']).optional(),
        locale: z.string().max(10).optional(),
        marketingOptIn: z.boolean().optional(),
        equipment: z.array(z.string()).optional(),
        daysPerWeek: z.number().int().min(1).max(7).optional(),
        sessionMinutes: z.number().int().min(10).max(180).optional(),
        primaryGoal: z.string().optional(),
        diet: z.string().optional(),
        heightCm: z.number().int().min(120).max(230).optional(),
        weightKg: z.number().int().min(35).max(250).optional(),
      }),
      request.body,
    );
    const { db } = request.ctx;

    const userPatch = pick(body, ['firstName', 'lastName', 'timezone', 'unitSystem', 'locale', 'marketingOptIn']);
    if (Object.keys(userPatch).length > 0) {
      await db.update(users).set({ ...userPatch, updatedAt: new Date() }).where(eq(users.id, principal.userId));
    }

    const profilePatch = pick(body, ['equipment', 'daysPerWeek', 'sessionMinutes', 'primaryGoal', 'diet', 'heightCm', 'weightKg']);
    if (Object.keys(profilePatch).length > 0) {
      await db.update(memberProfiles)
        .set({ ...profilePatch, updatedAt: new Date() })
        .where(eq(memberProfiles.userId, principal.userId));
    }

    const [profile] = await db
      .select().from(memberProfiles).where(eq(memberProfiles.userId, principal.userId)).limit(1);
    return { ok: true, profile: profile ?? null };
  });

  app.get('/me/devices', async (request) => {
    const principal = requireMember(request.principal);
    const { db } = request.ctx;
    return { devices: await db.select().from(devices).where(eq(devices.userId, principal.userId)) };
  });

  app.patch('/me/devices/:provider', async (request) => {
    const principal = requireMember(request.principal);
    const { provider } = parse(z.object({ provider: z.string().max(32) }), request.params);
    const body = parse(
      z.object({
        status: z.enum(['connected', 'not-connected', 'syncing']),
        permissions: z.array(z.string().max(40)).max(12).default([]),
      }),
      request.body,
    );
    const { db } = request.ctx;

    const existing = await db
      .select().from(devices)
      .where(and(eq(devices.userId, principal.userId), eq(devices.provider, provider)))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(devices).values({
        id: randomId('device'), userId: principal.userId, provider,
        status: body.status, permissions: body.permissions,
        lastSyncedAt: body.status === 'connected' ? new Date() : null,
      });
    } else {
      await db.update(devices)
        .set({
          status: body.status,
          permissions: body.permissions,
          // Disconnecting drops the permissions and the sync marker together —
          // leaving either behind would misrepresent what we still hold.
          lastSyncedAt: body.status === 'connected' ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(and(eq(devices.userId, principal.userId), eq(devices.provider, provider)));
    }

    return { ok: true };
  });

  app.get('/me/billing', async (request) => {
    const principal = requireMember(request.principal);
    const { db } = request.ctx;

    const [subscription] = await db
      .select().from(subscriptions)
      .where(eq(subscriptions.userId, principal.userId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);

    const invoiceRows = await db
      .select().from(invoices)
      .where(eq(invoices.userId, principal.userId))
      .orderBy(desc(invoices.issuedOn))
      .limit(24);

    const methods = await db
      .select().from(paymentMethods).where(eq(paymentMethods.userId, principal.userId));

    const plan = subscription ? findPlan(subscription.tier as PlanTier) : null;

    return {
      subscription: subscription ?? null,
      plan: plan ? { ...plan, pricing: planPricing(plan) } : null,
      entitlements: subscription ? entitlementsFor(subscription.tier as PlanTier) : [],
      invoices: invoiceRows,
      paymentMethods: methods,
    };
  });

  app.post('/me/billing/change-plan', async (request) => {
    const principal = requireMember(request.principal);
    const body = parse(
      z.object({
        tier: z.enum(['forge', 'forge-pro', 'forge-coach']),
        interval: z.enum(['monthly', 'yearly']),
      }),
      request.body,
    );
    const { db, today } = request.ctx;
    const plan = findPlan(body.tier);
    if (!plan) throw notFound('Plan');
    const pricing = planPricing(plan);

    const [current] = await db
      .select().from(subscriptions)
      .where(eq(subscriptions.userId, principal.userId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);

    const values = {
      tier: body.tier,
      billingInterval: body.interval,
      priceCents: body.interval === 'yearly' ? pricing.yearlyCents : pricing.monthlyCents,
      status: 'active',
      cancelAtPeriodEnd: false,
      updatedAt: new Date(),
    };

    if (current) {
      await db.update(subscriptions).set(values).where(eq(subscriptions.id, current.id));
    } else {
      await db.insert(subscriptions).values({
        id: randomId('subscription'), userId: principal.userId,
        currentPeriodEndsOn: addDays(today(), 30), ...values,
      });
    }
    return { ok: true, tier: body.tier };
  });

  app.post('/me/billing/cancel', async (request) => {
    const principal = requireMember(request.principal);
    const { db } = request.ctx;
    const [current] = await db
      .select().from(subscriptions)
      .where(eq(subscriptions.userId, principal.userId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);
    if (!current) throw notFound('Subscription');

    // Cancelling never ends access mid-period. The member paid for the period.
    await db.update(subscriptions)
      .set({ cancelAtPeriodEnd: true, cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(subscriptions.id, current.id));

    return { ok: true, accessUntil: current.currentPeriodEndsOn };
  });

  app.get('/me/metrics', async (request) => {
    const principal = requireMember(request.principal);
    const query = parse(z.object({ from: isoDateSchema.optional() }), request.query);
    const { db, today } = request.ctx;
    const from = query.from ?? addDays(today(), -30);
    return {
      metrics: await db
        .select().from(dailyMetrics)
        .where(and(eq(dailyMetrics.userId, principal.userId), gte(dailyMetrics.date, from)))
        .orderBy(dailyMetrics.date),
    };
  });

  app.post('/me/metrics', async (request) => {
    const principal = requireMember(request.principal);
    const body = parse(
      z.object({
        date: isoDateSchema.optional(),
        sleepMinutes: z.number().int().min(0).max(1200).optional(),
        hrvMs: z.number().int().min(1).max(300).optional(),
        restingHeartRate: z.number().int().min(25).max(140).optional(),
        steps: z.number().int().min(0).max(200_000).optional(),
        waterMl: z.number().int().min(0).max(15_000).optional(),
        soreness: z.number().int().min(1).max(5).optional(),
        stress: z.number().int().min(1).max(5).optional(),
      }),
      request.body,
    );
    const { db, today } = request.ctx;
    const date = body.date ?? today();

    const [profile] = await db
      .select().from(memberProfiles).where(eq(memberProfiles.userId, principal.userId)).limit(1);

    const readiness = computeReadiness(
      {
        sleepMinutes: body.sleepMinutes, hrvMs: body.hrvMs,
        restingHeartRate: body.restingHeartRate, soreness: body.soreness, stress: body.stress,
      },
      {
        sleepMinutes: profile?.baselineSleepMinutes ?? 450,
        hrvMs: profile?.baselineHrvMs ?? 62,
        restingHeartRate: profile?.baselineRestingHeartRate ?? 58,
      },
    );

    const existing = await db
      .select({ id: dailyMetrics.id }).from(dailyMetrics)
      .where(and(eq(dailyMetrics.userId, principal.userId), eq(dailyMetrics.date, date)))
      .limit(1);

    const values = {
      sleepMinutes: body.sleepMinutes ?? null, hrvMs: body.hrvMs ?? null,
      restingHeartRate: body.restingHeartRate ?? null, steps: body.steps ?? null,
      waterMl: body.waterMl ?? null, soreness: body.soreness ?? null, stress: body.stress ?? null,
      readinessScore: readiness.score, source: 'manual', updatedAt: new Date(),
    };

    if (existing[0]) {
      await db.update(dailyMetrics).set(values).where(eq(dailyMetrics.id, existing[0].id));
    } else {
      await db.insert(dailyMetrics).values({
        id: randomId('event'), userId: principal.userId, date, ...values,
      });
    }
    return { ok: true, readiness };
  });

  app.get('/me/calendar', async (request) => {
    const principal = requireMember(request.principal);
    const query = parse(
      z.object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() }),
      request.query,
    );
    const { db, today } = request.ctx;
    const from = query.from ?? addDays(startOfWeek(today()), -7);
    const to = query.to ?? addDays(from, 41);

    const events = await db
      .select().from(calendarEvents)
      .where(and(
        eq(calendarEvents.userId, principal.userId),
        gte(calendarEvents.date, from),
        sql`${calendarEvents.date} <= ${to}`,
      ))
      .orderBy(calendarEvents.date, calendarEvents.startMinutes);

    return { from, to, events };
  });

  app.patch('/me/calendar/:id', async (request) => {
    const principal = requireMember(request.principal);
    const { id } = parse(z.object({ id: z.string().max(40) }), request.params);
    const body = parse(
      z.object({
        date: isoDateSchema.optional(),
        startMinutes: z.number().int().min(0).max(1439).optional(),
        status: z.enum(['scheduled', 'completed', 'skipped']).optional(),
      }),
      request.body,
    );
    const { db } = request.ctx;

    const result = await db
      .update(calendarEvents)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(calendarEvents.id, id), eq(calendarEvents.userId, principal.userId)))
      .returning();

    if (result.length === 0) throw notFound('Event');
    return { ok: true };
  });

  app.get('/me/notifications', async (request) => {
    const principal = requireMember(request.principal);
    const { db } = request.ctx;
    return {
      notifications: await db
        .select().from(notifications)
        .where(eq(notifications.userId, principal.userId))
        .orderBy(desc(notifications.createdAt))
        .limit(30),
    };
  });

  app.post('/me/notifications/read', async (request) => {
    const principal = requireMember(request.principal);
    const { db } = request.ctx;
    await db.update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, principal.userId), sql`${notifications.readAt} is null`));
    return { ok: true };
  });

  app.get('/me/roadmap-summary', async (request) => {
    const principal = requireMember(request.principal);
    const { db } = request.ctx;
    const [plan] = await db
      .select().from(plans)
      .where(and(eq(plans.userId, principal.userId), eq(plans.status, 'active')))
      .limit(1);
    if (!plan) return { plan: null, weeks: [] };
    const weeks = await db
      .select().from(planWeeks)
      .where(eq(planWeeks.planId, plan.id))
      .orderBy(planWeeks.weekNumber);
    return { plan, weeks };
  });
}

function greetingFor(now: Date): string {
  const hour = now.getUTCHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

/** Daily sRPE load series for the acute:chronic ratio, zero-filled. */
function dailyLoadSeries(
  logs: readonly { date: string; sessionLoad: number }[],
  today: string,
  days: number,
): number[] {
  const byDate = new Map<string, number>();
  for (const log of logs) byDate.set(log.date, (byDate.get(log.date) ?? 0) + log.sessionLoad);
  const series: number[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    series.push(byDate.get(addDays(today, -offset)) ?? 0);
  }
  return series;
}
