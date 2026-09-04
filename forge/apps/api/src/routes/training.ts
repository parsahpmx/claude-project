import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  addDays, applyDifficultyFeedback, buildRoadmap, buildSession, buildPerformanceProfile,
  detectPersonalRecords, estimateOneRepMax, findExercise, findProgram, phaseForWeek,
  progressExercise, randomId, sessionLoad, startOfWeek, substituteExercise, workingLoadFrom,
  totalVolume, type AssessmentAnswers, type BuiltSession, type Equipment, type ExercisePrescription,
  type ExperienceLevel, type Phase, type SetLog,
} from '@forge/core';
import {
  calendarEvents, exerciseLoads, memberProfiles, personalRecords, planDays, plans,
  planWeeks, setLogs, workoutLogs,
} from '@forge/db';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireMember } from '../auth/guards.js';
import { isoDateSchema } from './schemas.js';

/**
 * Training: the plan, the workout player and completion.
 *
 * Session content is generated once, when the plan is created, and stored on
 * the plan day. Regenerating it on read would mean a member's Tuesday session
 * silently changed between Monday night and Tuesday morning — and their coach
 * would be looking at a different session again.
 */
export async function registerTrainingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me/plan', async (request) => {
    const principal = requireMember(request.principal);
    const { db, today } = request.ctx;

    const [plan] = await db
      .select().from(plans)
      .where(and(eq(plans.userId, principal.userId), eq(plans.status, 'active')))
      .limit(1);
    if (!plan) return { plan: null, weeks: [], progress: null };

    const weeks = await db
      .select().from(planWeeks).where(eq(planWeeks.planId, plan.id)).orderBy(planWeeks.weekNumber);
    const days = await db
      .select().from(planDays).where(eq(planDays.userId, principal.userId)).orderBy(planDays.date);

    const daysByWeek = new Map<string, typeof days>();
    for (const day of days) {
      const list = daysByWeek.get(day.planWeekId) ?? [];
      list.push(day);
      daysByWeek.set(day.planWeekId, list);
    }

    const completedSessions = days.filter((d) => d.status === 'completed').length;
    const totalSessions = days.filter((d) => d.kind !== 'rest').length;
    const date = today();
    const currentWeek = weeks.find((w) => w.startDate <= date && date <= w.endDate) ?? weeks[0] ?? null;

    const nextMilestone = weeks.find((w) => w.milestone && w.startDate >= date)?.milestone ?? null;

    return {
      plan: { ...plan, phases: safeParseJson<Phase[]>(plan.phases, []) },
      weeks: weeks.map((week) => ({ ...week, days: daysByWeek.get(week.id) ?? [] })),
      currentWeek,
      progress: {
        completedSessions,
        totalSessions,
        percent: totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0,
      },
      nextMilestone,
    };
  });

  app.post('/me/plan', async (request) => {
    const principal = requireMember(request.principal);
    const body = parse(
      z.object({
        programSlug: z.string().max(64),
        startDate: isoDateSchema.optional(),
        replaceExisting: z.boolean().default(false),
      }),
      request.body,
    );
    const { db, today } = request.ctx;

    const program = findProgram(body.programSlug);
    if (!program) throw notFound('Programme');

    const [profileRow] = await db
      .select().from(memberProfiles).where(eq(memberProfiles.userId, principal.userId)).limit(1);
    if (!profileRow) {
      throw badRequest('no_profile', 'Complete the fitness assessment before starting a programme.');
    }

    const existing = await db
      .select({ id: plans.id }).from(plans)
      .where(and(eq(plans.userId, principal.userId), eq(plans.status, 'active')));

    if (existing.length > 0 && !body.replaceExisting) {
      throw conflict('plan_exists', 'You already have an active plan. Finish or replace it first.');
    }
    if (existing.length > 0) {
      // Archive rather than delete: the history behind the Progress page is the
      // member's, and starting a new block must never erase it.
      await db.update(plans).set({ status: 'archived', updatedAt: new Date() })
        .where(and(eq(plans.userId, principal.userId), eq(plans.status, 'active')));
    }

    const answers = toAnswers(profileRow);
    const profile = buildPerformanceProfile(answers);
    const startDate = startOfWeek(body.startDate ?? today());

    const roadmap = buildRoadmap(
      {
        program, goal: answers.primaryGoal, level: profile.trainingLevel,
        sessionsPerWeek: profile.suggestedFrequency, sessionMinutes: profile.sessionMinutes,
        startDate, coached: answers.coaching === 'human-coach',
        nutritionGoal: profile.nutritionGoal, recoveryPriority: profile.recoveryPriority,
      },
      profile.phaseEmphasis,
    );

    const knownLoads = Object.fromEntries(
      (await db.select().from(exerciseLoads).where(eq(exerciseLoads.userId, principal.userId)))
        .map((row) => [row.exerciseId, row.workingLoadGrams]),
    );

    const planId = randomId('plan');
    await db.insert(plans).values({
      id: planId, userId: principal.userId, programSlug: program.slug, programName: program.name,
      goal: answers.primaryGoal, startDate: roadmap.startDate, totalWeeks: roadmap.totalWeeks,
      sessionsPerWeek: profile.suggestedFrequency, sessionMinutes: profile.sessionMinutes,
      status: 'active', phases: JSON.stringify(roadmap.phases),
    });

    for (const week of roadmap.weeks) {
      const weekId = randomId('planWeek');
      await db.insert(planWeeks).values({
        id: weekId, planId, weekNumber: week.weekNumber, phase: week.phase,
        startDate: week.startDate, endDate: week.endDate, deload: week.deload,
        nutritionGoal: week.nutritionGoal, recoveryTarget: week.recoveryTarget,
        coachCheckIn: week.coachCheckIn, milestone: week.milestone,
      });

      const dayRows = week.days.map((day) => {
        const built = day.sessionTemplate
          ? buildSession({
              session: day.sessionTemplate, equipment: answers.equipment,
              level: profile.trainingLevel, phase: phaseForWeek(roadmap.phases, week.weekNumber),
              deload: week.deload, minutes: day.minutes, knownLoads,
              bodyweightKg: answers.weightKg ?? 75,
            })
          : null;
        return {
          id: randomId('planDay'), planWeekId: weekId, userId: principal.userId, date: day.date,
          dayOfWeek: day.dayOfWeek, kind: day.kind, title: day.title, focus: day.focus,
          minutes: day.minutes, patterns: day.patterns, status: 'scheduled',
          sessionTemplate: built ? JSON.stringify(built) : null,
        };
      });
      await db.insert(planDays).values(dayRows);

      await db.insert(calendarEvents).values(
        dayRows
          .filter((row) => row.kind !== 'rest')
          .map((row) => ({
            id: randomId('event'), userId: principal.userId, kind: 'workout', title: row.title,
            date: row.date, startMinutes: row.kind === 'running' ? 7 * 60 : 17 * 60 + 30,
            durationMinutes: row.minutes, referenceId: row.id, status: 'scheduled',
          })),
      );
    }

    return { ok: true, planId, program: program.slug, weeks: roadmap.totalWeeks };
  });

  app.get('/me/plan/days/:id', async (request) => {
    const principal = requireMember(request.principal);
    const { id } = parse(z.object({ id: z.string().max(40) }), request.params);
    const { db } = request.ctx;

    const [day] = await db
      .select().from(planDays)
      .where(and(eq(planDays.id, id), eq(planDays.userId, principal.userId)))
      .limit(1);
    if (!day) throw notFound('Session');

    const session = safeParseJson<BuiltSession | null>(day.sessionTemplate ?? 'null', null);
    const loads = await db.select().from(exerciseLoads).where(eq(exerciseLoads.userId, principal.userId));
    const loadByExercise = new Map(loads.map((row) => [row.exerciseId, row]));

    return {
      day,
      session: session
        ? {
            ...session,
            exercises: session.exercises.map((exercise) => {
              const history = loadByExercise.get(exercise.exerciseId);
              return {
                ...exercise,
                // "Previous: 95kg × 8" is read from the member's own history,
                // never from the prescription, so it is always a fact.
                previous: history
                  ? {
                      loadGrams: history.workingLoadGrams,
                      reps: history.lastReps,
                      rpe: history.lastRpe,
                      bestLoadGrams: history.bestLoadGrams,
                    }
                  : null,
              };
            }),
          }
        : null,
    };
  });

  app.patch('/me/plan/days/:id', async (request) => {
    const principal = requireMember(request.principal);
    const { id } = parse(z.object({ id: z.string().max(40) }), request.params);
    const body = parse(
      z.object({
        action: z.enum(['reschedule', 'skip', 'restore', 'shorten', 'substitute']),
        date: isoDateSchema.optional(),
        minutes: z.number().int().min(10).max(180).optional(),
        exerciseId: z.string().max(64).optional(),
        replacementId: z.string().max(64).optional(),
      }),
      request.body,
    );
    const { db } = request.ctx;

    const [day] = await db
      .select().from(planDays)
      .where(and(eq(planDays.id, id), eq(planDays.userId, principal.userId)))
      .limit(1);
    if (!day) throw notFound('Session');
    if (day.status === 'completed') {
      throw conflict('already_completed', 'That session is already logged and cannot be changed.');
    }

    const [profileRow] = await db
      .select().from(memberProfiles).where(eq(memberProfiles.userId, principal.userId)).limit(1);
    const equipment = (profileRow?.equipment ?? ['bodyweight']) as Equipment[];

    switch (body.action) {
      case 'reschedule': {
        if (!body.date) throw badRequest('missing_date', 'A new date is required to reschedule.');
        await db.update(planDays)
          .set({ date: body.date, rescheduledFrom: day.rescheduledFrom ?? day.date, updatedAt: new Date() })
          .where(eq(planDays.id, id));
        await db.update(calendarEvents).set({ date: body.date, updatedAt: new Date() })
          .where(and(eq(calendarEvents.referenceId, id), eq(calendarEvents.userId, principal.userId)));
        return { ok: true, date: body.date };
      }
      case 'skip':
        await db.update(planDays).set({ status: 'skipped', updatedAt: new Date() }).where(eq(planDays.id, id));
        return { ok: true };
      case 'restore':
        await db.update(planDays).set({ status: 'scheduled', updatedAt: new Date() }).where(eq(planDays.id, id));
        return { ok: true };
      case 'shorten': {
        const minutes = body.minutes ?? 30;
        const session = safeParseJson<BuiltSession | null>(day.sessionTemplate ?? 'null', null);
        if (!session) throw badRequest('no_session', 'This day has no session to shorten.');
        const shortened = shortenSession(session, minutes);
        await db.update(planDays)
          .set({ minutes, sessionTemplate: JSON.stringify(shortened), updatedAt: new Date() })
          .where(eq(planDays.id, id));
        return { ok: true, session: shortened };
      }
      case 'substitute': {
        if (!body.exerciseId) throw badRequest('missing_exercise', 'Name the exercise to substitute.');
        const session = safeParseJson<BuiltSession | null>(day.sessionTemplate ?? 'null', null);
        if (!session) throw badRequest('no_session', 'This day has no session to change.');

        const replacement = body.replacementId
          ? findExercise(body.replacementId)
          : substituteExercise(body.exerciseId, equipment);
        if (!replacement) {
          throw badRequest(
            'no_substitute',
            'No substitute trains that pattern with the equipment on your profile.',
          );
        }

        const updated: BuiltSession = {
          ...session,
          exercises: session.exercises.map((exercise) =>
            exercise.exerciseId === body.exerciseId
              ? {
                  ...exercise,
                  exerciseId: replacement.id,
                  name: replacement.name,
                  cue: replacement.cue,
                  pattern: replacement.pattern,
                  timed: replacement.timed === true,
                }
              : exercise,
          ),
        };
        await db.update(planDays)
          .set({ sessionTemplate: JSON.stringify(updated), updatedAt: new Date() })
          .where(eq(planDays.id, id));
        return { ok: true, replacement: { id: replacement.id, name: replacement.name }, session: updated };
      }
      default:
        throw badRequest('unknown_action', 'That action is not supported.');
    }
  });

  app.post('/me/workouts', async (request) => {
    const principal = requireMember(request.principal);
    const body = parse(
      z.object({
        planDayId: z.string().max(40).optional(),
        title: z.string().max(120).default('Training session'),
        kind: z.string().max(16).default('strength'),
        date: isoDateSchema.optional(),
        durationSeconds: z.number().int().min(0).max(6 * 3600),
        averageHeartRate: z.number().int().min(30).max(230).optional(),
        maxHeartRate: z.number().int().min(30).max(230).optional(),
        difficultyFeedback: z.enum(['too-easy', 'perfect', 'too-hard']).optional(),
        notes: z.string().max(2000).optional(),
        sets: z
          .array(
            z.object({
              exerciseId: z.string().max(64),
              exerciseName: z.string().max(120),
              setIndex: z.number().int().min(1).max(30),
              reps: z.number().int().min(0).max(500),
              loadGrams: z.number().int().min(0).max(1_000_000),
              rpe: z.number().min(1).max(10).optional(),
              completed: z.boolean().default(true),
              restSeconds: z.number().int().min(0).max(1800).optional(),
            }),
          )
          .max(200)
          .default([]),
      }),
      request.body,
    );
    const { db, today } = request.ctx;
    const date = body.date ?? today();

    let planDay: typeof planDays.$inferSelect | undefined;
    if (body.planDayId) {
      [planDay] = await db
        .select().from(planDays)
        .where(and(eq(planDays.id, body.planDayId), eq(planDays.userId, principal.userId)))
        .limit(1);
      if (!planDay) throw notFound('Session');
      if (planDay.status === 'completed') {
        throw conflict('already_completed', 'This session has already been logged.');
      }
    }

    const [profileRow] = await db
      .select().from(memberProfiles).where(eq(memberProfiles.userId, principal.userId)).limit(1);
    const level = (profileRow?.experience ?? 'intermediate') as ExperienceLevel;

    const workoutId = randomId('workoutLog');
    const completedSets = body.sets.filter((s) => s.completed);
    const volume = totalVolume(completedSets.map(toSetLog));
    const rpes = completedSets.map((s) => s.rpe).filter((r): r is number => typeof r === 'number');
    const averageRpe = rpes.length > 0 ? Math.round(rpes.reduce((a, b) => a + b, 0) / rpes.length) : null;
    const minutes = Math.round(body.durationSeconds / 60);

    const muscleGroups = new Set<string>();
    for (const set of completedSets) {
      const exercise = findExercise(set.exerciseId);
      if (exercise) for (const group of exercise.primary) muscleGroups.add(group);
    }

    await db.insert(workoutLogs).values({
      id: workoutId, userId: principal.userId, planDayId: planDay?.id ?? null,
      title: planDay?.title ?? body.title, kind: planDay?.kind ?? body.kind, date,
      startedAt: new Date(Date.now() - body.durationSeconds * 1000), completedAt: new Date(),
      durationSeconds: body.durationSeconds, volumeGrams: volume,
      calories: Math.round(minutes * 8.4),
      averageHeartRate: body.averageHeartRate ?? null, maxHeartRate: body.maxHeartRate ?? null,
      averageRpe, sessionLoad: sessionLoad(minutes, averageRpe ?? 7),
      difficultyFeedback: body.difficultyFeedback ?? null,
      muscleGroups: [...muscleGroups], notes: body.notes ?? null,
    });

    if (body.sets.length > 0) {
      await db.insert(setLogs).values(
        body.sets.map((set) => ({
          id: randomId('setLog'), workoutLogId: workoutId, exerciseId: set.exerciseId,
          exerciseName: set.exerciseName, setIndex: set.setIndex, reps: set.reps,
          loadGrams: set.loadGrams, rpe: set.rpe ? Math.round(set.rpe) : null,
          completed: set.completed, restSeconds: set.restSeconds ?? null,
        })),
      );
    }

    // ---- progression, personal records and the next prescription
    const session = planDay?.sessionTemplate
      ? safeParseJson<BuiltSession | null>(planDay.sessionTemplate, null)
      : null;
    const existingLoads = await db
      .select().from(exerciseLoads).where(eq(exerciseLoads.userId, principal.userId));
    const loadByExercise = new Map(existingLoads.map((row) => [row.exerciseId, row]));

    const byExercise = new Map<string, typeof body.sets>();
    for (const set of body.sets) {
      const list = byExercise.get(set.exerciseId) ?? [];
      list.push(set);
      byExercise.set(set.exerciseId, list);
    }

    const newRecords: (typeof personalRecords.$inferInsert)[] = [];
    const decisions: { exerciseId: string; action: string; reason: string; nextLoadGrams: number }[] = [];

    for (const [exerciseId, sets] of byExercise) {
      const definition = findExercise(exerciseId);
      const logs = sets.map(toSetLog);
      const history = loadByExercise.get(exerciseId);
      const bestLoad = history?.bestLoadGrams ?? 0;
      const bestOneRepMax = history?.bestEstimatedOneRepMax ?? 0;

      for (const record of detectPersonalRecords(exerciseId, logs, {
        bestLoadGrams: bestLoad, bestEstimatedOneRepMax: bestOneRepMax,
      })) {
        newRecords.push({
          id: randomId('workoutLog'), userId: principal.userId, exerciseId,
          exerciseName: sets[0]?.exerciseName ?? definition?.name ?? exerciseId,
          kind: record.kind, valueGrams: record.value, previousValueGrams: record.previousValue,
          reps: record.reps, achievedOn: date, workoutLogId: workoutId,
        });
      }

      const prescribed = session?.exercises.find((e) => e.exerciseId === exerciseId)?.prescription
        ?? fallbackPrescription(sets);
      const decision = progressExercise(prescribed, logs, {
        type: 'double-progression', level, plateGrams: definition?.plateGrams ?? 2500,
      });
      decisions.push({
        exerciseId, action: decision.action, reason: decision.reason,
        nextLoadGrams: decision.next.loadGrams,
      });

      const heaviest = logs.reduce((best, l) => (l.completed ? Math.max(best, l.loadGrams) : best), 0);
      const bestEstimate = logs.reduce(
        (best, l) => (l.completed ? Math.max(best, estimateOneRepMax(l.loadGrams, l.reps) ?? 0) : best),
        0,
      );
      const lastSet = sets.at(-1);

      const values = {
        // The prescription carries this phase's intensity bias; store the load
        // without it, or the bias compounds and the block drifts lighter.
        workingLoadGrams: workingLoadFrom(decision.next, prescribed, definition?.plateGrams ?? 2500),
        lastReps: lastSet?.reps ?? null,
        lastRpe: lastSet?.rpe ? Math.round(lastSet.rpe) : null,
        bestLoadGrams: Math.max(bestLoad, heaviest),
        bestEstimatedOneRepMax: Math.max(bestOneRepMax, bestEstimate),
        updatedAt: new Date(),
      };

      if (history) {
        await db.update(exerciseLoads).set(values).where(eq(exerciseLoads.id, history.id));
      } else {
        await db.insert(exerciseLoads).values({
          id: randomId('exercise'), userId: principal.userId, exerciseId, ...values,
        });
      }
    }

    if (newRecords.length > 0) await db.insert(personalRecords).values(newRecords);

    if (planDay) {
      await db.update(planDays)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(planDays.id, planDay.id));
      await db.update(calendarEvents)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(and(eq(calendarEvents.referenceId, planDay.id), eq(calendarEvents.userId, principal.userId)));

      // The difficulty answer feeds the *next* scheduled session of the same
      // kind — that is what makes the question worth asking.
      if (body.difficultyFeedback && body.difficultyFeedback !== 'perfect') {
        await applyFeedbackToNextSession(db, principal.userId, planDay, body.difficultyFeedback, date);
      }
    }

    return {
      ok: true,
      workoutId,
      summary: {
        durationSeconds: body.durationSeconds,
        volumeGrams: volume,
        calories: Math.round(minutes * 8.4),
        setsCompleted: completedSets.length,
        exercises: byExercise.size,
        averageRpe,
      },
      personalRecords: newRecords.map((r) => ({
        exerciseId: r.exerciseId, exerciseName: r.exerciseName, kind: r.kind,
        value: r.valueGrams, previousValue: r.previousValueGrams, reps: r.reps,
      })),
      progression: decisions,
    };
  });

  app.get('/me/workouts', async (request) => {
    const principal = requireMember(request.principal);
    const query = parse(
      z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), from: isoDateSchema.optional() }),
      request.query,
    );
    const { db, today } = request.ctx;
    const from = query.from ?? addDays(today(), -90);

    const logs = await db
      .select().from(workoutLogs)
      .where(and(eq(workoutLogs.userId, principal.userId), gte(workoutLogs.date, from)))
      .orderBy(desc(workoutLogs.date))
      .limit(query.limit);

    return { workouts: logs };
  });

  app.get('/me/workouts/:id', async (request) => {
    const principal = requireMember(request.principal);
    const { id } = parse(z.object({ id: z.string().max(40) }), request.params);
    const { db } = request.ctx;

    const [workout] = await db
      .select().from(workoutLogs)
      .where(and(eq(workoutLogs.id, id), eq(workoutLogs.userId, principal.userId)))
      .limit(1);
    if (!workout) throw notFound('Workout');

    const sets = await db
      .select().from(setLogs).where(eq(setLogs.workoutLogId, id)).orderBy(setLogs.setIndex);
    const records = await db
      .select().from(personalRecords).where(eq(personalRecords.workoutLogId, id));

    return { workout, sets, personalRecords: records };
  });
}

function toSetLog(set: {
  reps: number; loadGrams: number; rpe?: number | undefined; completed: boolean;
}): SetLog {
  return {
    reps: set.reps,
    loadGrams: set.loadGrams,
    ...(typeof set.rpe === 'number' ? { rpe: set.rpe } : {}),
    completed: set.completed,
  };
}

function fallbackPrescription(sets: readonly { reps: number; loadGrams: number }[]): ExercisePrescription {
  const first = sets[0];
  return {
    sets: sets.length,
    reps: first?.reps ?? 8,
    loadGrams: first?.loadGrams ?? 0,
    restSeconds: 120,
  };
}

/**
 * Trim a session to a time budget by dropping accessories from the end.
 * Compounds and the first movement are never removed — that is the session.
 */
function shortenSession(session: BuiltSession, minutes: number): BuiltSession {
  const budget = Math.max(10, minutes) - 8;
  const kept: typeof session.exercises = [];
  let spent = 0;
  for (const exercise of session.exercises) {
    const cost = exercise.prescription.sets * 2 + 2;
    if (kept.length > 0 && spent + cost > budget) break;
    kept.push(exercise);
    spent += cost;
  }
  return {
    ...session,
    minutes,
    exercises: kept,
    coachNote: `${session.coachNote} Shortened to ${minutes} minutes — main work kept, accessories trimmed.`,
  };
}

async function applyFeedbackToNextSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
  planDay: typeof planDays.$inferSelect,
  feedback: 'too-easy' | 'too-hard',
  date: string,
): Promise<void> {
  const upcoming = await db
    .select().from(planDays)
    .where(and(
      eq(planDays.userId, userId),
      eq(planDays.title, planDay.title),
      sql`${planDays.date} > ${date}`,
      eq(planDays.status, 'scheduled'),
    ))
    .orderBy(planDays.date)
    .limit(1);

  const next = upcoming[0] as typeof planDays.$inferSelect | undefined;
  if (!next?.sessionTemplate) return;

  const session = safeParseJson<BuiltSession | null>(next.sessionTemplate, null);
  if (!session) return;

  const adjusted = applyDifficultyFeedback(
    session.exercises.map((e) => e.prescription),
    feedback,
  );
  const updated: BuiltSession = {
    ...session,
    exercises: session.exercises.map((exercise, index) => ({
      ...exercise,
      prescription: adjusted[index] ?? exercise.prescription,
    })),
  };

  await db.update(planDays)
    .set({ sessionTemplate: JSON.stringify(updated), updatedAt: new Date() })
    .where(eq(planDays.id, next.id));
}

function toAnswers(profile: typeof memberProfiles.$inferSelect): AssessmentAnswers {
  return {
    primaryGoal: profile.primaryGoal as AssessmentAnswers['primaryGoal'],
    secondaryGoals: profile.secondaryGoals as AssessmentAnswers['secondaryGoals'],
    ageRange: profile.ageRange as AssessmentAnswers['ageRange'],
    experience: profile.experience as ExperienceLevel,
    daysPerWeek: profile.daysPerWeek,
    sessionMinutes: profile.sessionMinutes,
    location: profile.trainingLocation as AssessmentAnswers['location'],
    equipment: profile.equipment as Equipment[],
    diet: profile.diet as AssessmentAnswers['diet'],
    coaching: profile.coachingPreference as AssessmentAnswers['coaching'],
    ...(profile.heightCm !== null ? { heightCm: profile.heightCm } : {}),
    ...(profile.weightKg !== null ? { weightKg: profile.weightKg } : {}),
    ...(profile.sexAtBirth !== null ? { sexAtBirth: profile.sexAtBirth as AssessmentAnswers['sexAtBirth'] } : {}),
  };
}

function safeParseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
