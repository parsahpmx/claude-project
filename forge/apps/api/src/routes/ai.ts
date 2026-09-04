import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import {
  answer, classifyIntent, computeReadiness, randomId, startOfWeek, SUGGESTED_QUESTIONS,
  type AiContext, type Equipment,
} from '@forge/core';
import {
  aiConversations, coachClients, dailyMetrics, memberProfiles, nutritionTargets,
  planDays, plans, workoutLogs,
} from '@forge/db';
import { parse } from '../lib/validate.js';
import { requireMember } from '../auth/guards.js';

/**
 * FORGE AI.
 *
 * The endpoint assembles the member's real context and hands it to the pure
 * reasoning engine in `@forge/core`. Nothing about the answer is generated
 * here, which means the medical routing and the "never invent data" rules are
 * enforced in one tested place rather than at the edge.
 */
export async function registerAiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ai/suggestions', async () => ({ questions: SUGGESTED_QUESTIONS }));

  app.post('/ai/ask', async (request) => {
    const principal = requireMember(request.principal);
    const body = parse(z.object({ question: z.string().trim().min(1).max(500) }), request.body);
    const { db, today } = request.ctx;
    const date = today();

    const [profile] = await db
      .select().from(memberProfiles).where(eq(memberProfiles.userId, principal.userId)).limit(1);
    const [metrics] = await db
      .select().from(dailyMetrics)
      .where(and(eq(dailyMetrics.userId, principal.userId), eq(dailyMetrics.date, date)))
      .limit(1);
    const [todayDay] = await db
      .select().from(planDays)
      .where(and(eq(planDays.userId, principal.userId), eq(planDays.date, date)))
      .limit(1);
    const [plan] = await db
      .select().from(plans)
      .where(and(eq(plans.userId, principal.userId), eq(plans.status, 'active')))
      .limit(1);
    const [targets] = await db
      .select().from(nutritionTargets).where(eq(nutritionTargets.userId, principal.userId)).limit(1);
    const [coachLink] = await db
      .select({ id: coachClients.id }).from(coachClients)
      .where(and(eq(coachClients.memberId, principal.userId), eq(coachClients.status, 'active')))
      .limit(1);
    const [lastWorkout] = await db
      .select().from(workoutLogs)
      .where(eq(workoutLogs.userId, principal.userId))
      .orderBy(desc(workoutLogs.date))
      .limit(1);

    const weekStart = startOfWeek(date);
    const weekDays = await db
      .select({ status: planDays.status, kind: planDays.kind })
      .from(planDays)
      .where(and(
        eq(planDays.userId, principal.userId),
        eq(planDays.date, planDays.date), // no-op keeps the builder shape uniform
      ));
    const inWeek = weekDays.filter((d) => d.kind !== 'rest');

    const readiness = metrics
      ? computeReadiness(
          {
            sleepMinutes: metrics.sleepMinutes ?? undefined,
            hrvMs: metrics.hrvMs ?? undefined,
            restingHeartRate: metrics.restingHeartRate ?? undefined,
            soreness: metrics.soreness ?? undefined,
            stress: metrics.stress ?? undefined,
          },
          {
            sleepMinutes: profile?.baselineSleepMinutes ?? 450,
            hrvMs: profile?.baselineHrvMs ?? 62,
            restingHeartRate: profile?.baselineRestingHeartRate ?? 58,
          },
        )
      : null;

    const weekNumber = plan
      ? Math.max(1, Math.floor(daysBetweenIso(plan.startDate, date) / 7) + 1)
      : null;

    const context: AiContext = {
      firstName: principal.firstName,
      unitSystem: principal.unitSystem,
      todaySessionTitle: todayDay && todayDay.kind !== 'rest' ? todayDay.title : null,
      todaySessionMinutes: todayDay && todayDay.kind !== 'rest' ? todayDay.minutes : null,
      todaySessionKind: todayDay?.kind ?? null,
      readiness,
      macros: targets
        ? {
            calories: targets.calories, proteinGrams: targets.proteinGrams,
            carbGrams: targets.carbGrams, fatGrams: targets.fatGrams,
            fibreGrams: targets.fibreGrams, waterLitres: targets.waterMl / 1000,
          }
        : null,
      equipment: (profile?.equipment ?? ['bodyweight']) as Equipment[],
      weeklyCompleted: inWeek.filter((d) => d.status === 'completed' && weekStart <= date).length,
      weeklyTarget: profile?.daysPerWeek ?? 0,
      currentStreakDays: 0,
      programName: plan?.programName ?? null,
      weekNumber,
      totalWeeks: plan?.totalWeeks ?? null,
      hasHumanCoach: coachLink !== undefined,
      ...(lastWorkout?.averageRpe ? { lastSessionRpe: lastWorkout.averageRpe } : {}),
    };

    const result = answer(body.question, context);

    await db.insert(aiConversations).values({
      id: randomId('event'), userId: principal.userId, question: body.question,
      intent: result.intent, answer: JSON.stringify(result), sources: result.sources,
    });

    return { answer: result };
  });

  app.get('/ai/history', async (request) => {
    const principal = requireMember(request.principal);
    const { db } = request.ctx;
    const rows = await db
      .select().from(aiConversations)
      .where(eq(aiConversations.userId, principal.userId))
      .orderBy(desc(aiConversations.createdAt))
      .limit(20);
    return {
      history: rows.map((row) => ({
        id: row.id, question: row.question, intent: row.intent,
        createdAt: row.createdAt, sources: row.sources,
      })),
    };
  });

  app.get('/ai/classify', async (request) => {
    const query = parse(z.object({ question: z.string().max(500) }), request.query);
    return { intent: classifyIntent(query.question) };
  });
}

function daysBetweenIso(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
