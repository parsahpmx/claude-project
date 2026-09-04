import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import {
  addDays, adherence, coachCapacity, randomId, scoreCheckIn, startOfWeek, summariseProgress,
  type MuscleGroup,
} from '@forge/core';
import {
  bookings, checkIns, coachClients, coaches, coachNotes, exerciseLoads, memberProfiles,
  messages, messageThreads, personalRecords, planDays, plans, users, workoutLogs,
} from '@forge/db';
import { forbidden, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireCoach } from '../auth/guards.js';

/**
 * The coach workspace.
 *
 * Every read is joined through `coach_clients`, so a coach can only ever see
 * members who are actually their clients. There is no endpoint here that takes
 * a member id and trusts it.
 */
export async function registerCoachRoutes(app: FastifyInstance): Promise<void> {
  app.get('/coach/overview', async (request) => {
    const coach = requireCoach(request.principal);
    const { db, today } = request.ctx;
    const date = today();
    const weekStart = startOfWeek(date);

    const clients = await db
      .select({ memberId: coachClients.memberId })
      .from(coachClients)
      .where(and(eq(coachClients.coachId, coach.coachId), eq(coachClients.status, 'active')));
    const clientIds = clients.map((c) => c.memberId);

    const pending = clientIds.length > 0
      ? await db
          .select({ count: sql<number>`count(*)::int` })
          .from(checkIns)
          .where(and(
            eq(checkIns.coachId, coach.coachId),
            sql`${checkIns.respondedAt} is null`,
          ))
      : [];

    const threads = await db
      .select({ id: messageThreads.id }).from(messageThreads)
      .where(eq(messageThreads.coachId, coach.coachId));

    const unread = threads.length > 0
      ? await db
          .select({ count: sql<number>`count(*)::int` })
          .from(messages)
          .where(and(
            sql`${messages.threadId} in ${threads.map((t) => t.id)}`,
            sql`${messages.senderId} <> ${coach.userId}`,
            sql`${messages.readAt} is null`,
          ))
      : [];

    const upcoming = await db
      .select({ booking: bookings, member: { firstName: users.firstName, lastName: users.lastName } })
      .from(bookings)
      .innerJoin(users, eq(users.id, bookings.memberId))
      .where(and(
        eq(bookings.coachId, coach.coachId),
        gte(bookings.startsAt, new Date(`${date}T00:00:00Z`)),
        eq(bookings.status, 'confirmed'),
      ))
      .orderBy(asc(bookings.startsAt))
      .limit(8);

    const [profile] = await db.select().from(coaches).where(eq(coaches.id, coach.coachId)).limit(1);

    const flagged = await db
      .select({
        checkIn: checkIns,
        member: { id: users.id, firstName: users.firstName, lastName: users.lastName, avatarKey: users.avatarKey },
      })
      .from(checkIns)
      .innerJoin(users, eq(users.id, checkIns.memberId))
      .where(and(
        eq(checkIns.coachId, coach.coachId),
        sql`array_length(${checkIns.flags}, 1) > 0`,
        gte(checkIns.weekStart, addDays(weekStart, -21)),
      ))
      .orderBy(asc(checkIns.score))
      .limit(6);

    const workload = {
      activeClients: clientIds.length,
      pendingCheckIns: pending[0]?.count ?? 0,
      unreadMessages: unread[0]?.count ?? 0,
      upcomingCalls: upcoming.length,
    };

    return {
      coach: profile ?? null,
      workload,
      capacity: coachCapacity(workload, profile?.clientCap ?? 40),
      upcomingCalls: upcoming,
      needsAttention: flagged,
    };
  });

  app.get('/coach/clients', async (request) => {
    const coach = requireCoach(request.principal);
    const { db, today } = request.ctx;
    const weekStart = startOfWeek(today());

    const rows = await db
      .select({
        relationship: coachClients,
        member: {
          id: users.id, firstName: users.firstName, lastName: users.lastName,
          email: users.email, avatarKey: users.avatarKey, lastSeenAt: users.lastSeenAt,
        },
        profile: memberProfiles,
      })
      .from(coachClients)
      .innerJoin(users, eq(users.id, coachClients.memberId))
      .leftJoin(memberProfiles, eq(memberProfiles.userId, coachClients.memberId))
      .where(and(eq(coachClients.coachId, coach.coachId), eq(coachClients.status, 'active')));

    const memberIds = rows.map((row) => row.member.id);
    if (memberIds.length === 0) return { clients: [] };

    const weekDays = await db
      .select({ userId: planDays.userId, status: planDays.status, kind: planDays.kind })
      .from(planDays)
      .where(and(
        sql`${planDays.userId} in ${memberIds}`,
        gte(planDays.date, weekStart),
        sql`${planDays.date} <= ${addDays(weekStart, 6)}`,
      ));

    const latestCheckIns = await db
      .select().from(checkIns)
      .where(and(eq(checkIns.coachId, coach.coachId), gte(checkIns.weekStart, addDays(weekStart, -28))))
      .orderBy(desc(checkIns.weekStart));

    return {
      clients: rows.map((row) => {
        const days = weekDays.filter((d) => d.userId === row.member.id && d.kind !== 'rest');
        const completed = days.filter((d) => d.status === 'completed').length;
        const checkIn = latestCheckIns.find((entry) => entry.memberId === row.member.id) ?? null;
        return {
          member: row.member,
          profile: row.profile,
          startedOn: row.relationship.startedOn,
          week: {
            completed,
            scheduled: days.length,
            adherencePercent: adherence(completed, days.length),
          },
          latestCheckIn: checkIn,
          needsResponse: checkIn !== null && checkIn.respondedAt === null,
        };
      }),
    };
  });

  app.get('/coach/clients/:memberId', async (request) => {
    const coach = requireCoach(request.principal);
    const { memberId } = parse(z.object({ memberId: z.string().max(40) }), request.params);
    const { db, today } = request.ctx;

    await assertClientOf(db, coach.coachId, memberId);

    const [member] = await db
      .select({
        id: users.id, firstName: users.firstName, lastName: users.lastName,
        email: users.email, avatarKey: users.avatarKey, timezone: users.timezone,
      })
      .from(users).where(eq(users.id, memberId)).limit(1);

    const [profile] = await db
      .select().from(memberProfiles).where(eq(memberProfiles.userId, memberId)).limit(1);
    const [plan] = await db
      .select().from(plans)
      .where(and(eq(plans.userId, memberId), eq(plans.status, 'active')))
      .limit(1);

    const recentWorkouts = await db
      .select().from(workoutLogs)
      .where(and(eq(workoutLogs.userId, memberId), gte(workoutLogs.date, addDays(today(), -56))))
      .orderBy(desc(workoutLogs.date))
      .limit(40);

    const records = await db
      .select().from(personalRecords)
      .where(eq(personalRecords.userId, memberId))
      .orderBy(desc(personalRecords.achievedOn))
      .limit(12);

    const loads = await db.select().from(exerciseLoads).where(eq(exerciseLoads.userId, memberId));

    const history = await db
      .select().from(checkIns)
      .where(and(eq(checkIns.memberId, memberId), eq(checkIns.coachId, coach.coachId)))
      .orderBy(desc(checkIns.weekStart))
      .limit(12);

    const notes = await db
      .select().from(coachNotes)
      .where(and(eq(coachNotes.coachId, coach.coachId), eq(coachNotes.memberId, memberId)))
      .orderBy(desc(coachNotes.createdAt));

    const [thread] = await db
      .select().from(messageThreads)
      .where(and(eq(messageThreads.coachId, coach.coachId), eq(messageThreads.memberId, memberId)))
      .limit(1);

    return {
      member: member ?? null,
      profile: profile ?? null,
      plan: plan ?? null,
      summary: summariseProgress(
        recentWorkouts.map((w) => ({
          date: w.date, durationMinutes: Math.round(w.durationSeconds / 60),
          volumeGrams: w.volumeGrams, calories: w.calories, kind: w.kind,
          muscleGroups: w.muscleGroups as MuscleGroup[],
        })),
        today(),
      ),
      recentWorkouts,
      personalRecords: records,
      workingLoads: loads,
      checkIns: history,
      notes,
      threadId: thread?.id ?? null,
    };
  });

  app.post('/coach/clients/:memberId/notes', async (request) => {
    const coach = requireCoach(request.principal);
    const { memberId } = parse(z.object({ memberId: z.string().max(40) }), request.params);
    const body = parse(
      z.object({
        body: z.string().trim().min(1).max(4000),
        visibility: z.enum(['private', 'shared']).default('private'),
      }),
      request.body,
    );
    const { db } = request.ctx;

    await assertClientOf(db, coach.coachId, memberId);

    const id = randomId('coach');
    await db.insert(coachNotes).values({
      id, coachId: coach.coachId, memberId, body: body.body, visibility: body.visibility,
    });
    return { ok: true, id };
  });

  app.get('/coach/check-ins', async (request) => {
    const coach = requireCoach(request.principal);
    const query = parse(
      z.object({ status: z.enum(['pending', 'answered', 'all']).default('pending') }),
      request.query,
    );
    const { db } = request.ctx;

    const rows = await db
      .select({
        checkIn: checkIns,
        member: { id: users.id, firstName: users.firstName, lastName: users.lastName, avatarKey: users.avatarKey },
      })
      .from(checkIns)
      .innerJoin(users, eq(users.id, checkIns.memberId))
      .where(eq(checkIns.coachId, coach.coachId))
      .orderBy(desc(checkIns.weekStart))
      .limit(60);

    const filtered = rows.filter((row) => {
      if (query.status === 'pending') return row.checkIn.respondedAt === null;
      if (query.status === 'answered') return row.checkIn.respondedAt !== null;
      return true;
    });

    return {
      checkIns: filtered.map((row) => ({
        ...row,
        // Re-scored on read so a change to the scoring rules is reflected for
        // the coach immediately rather than only on new submissions.
        scoring: scoreCheckIn({
          energy: row.checkIn.energy, sleepQuality: row.checkIn.sleepQuality,
          stress: row.checkIn.stress, nutritionAdherence: row.checkIn.nutritionAdherence,
          trainingAdherence: row.checkIn.trainingAdherence,
          ...(row.checkIn.painNotes ? { painNotes: row.checkIn.painNotes } : {}),
          ...(row.checkIn.questions ? { questionsForCoach: row.checkIn.questions } : {}),
        }),
      })),
    };
  });

  app.post('/coach/check-ins/:id/respond', async (request) => {
    const coach = requireCoach(request.principal);
    const { id } = parse(z.object({ id: z.string().max(40) }), request.params);
    const body = parse(z.object({ response: z.string().trim().min(1).max(4000) }), request.body);
    const { db } = request.ctx;

    const result = await db
      .update(checkIns)
      .set({ coachResponse: body.response, respondedAt: new Date() })
      .where(and(eq(checkIns.id, id), eq(checkIns.coachId, coach.coachId)))
      .returning();

    if (result.length === 0) throw notFound('Check-in');
    return { ok: true };
  });

  app.get('/coach/calendar', async (request) => {
    const coach = requireCoach(request.principal);
    const { db, today } = request.ctx;

    return {
      bookings: await db
        .select({
          booking: bookings,
          member: { id: users.id, firstName: users.firstName, lastName: users.lastName },
        })
        .from(bookings)
        .innerJoin(users, eq(users.id, bookings.memberId))
        .where(and(
          eq(bookings.coachId, coach.coachId),
          gte(bookings.startsAt, new Date(`${addDays(today(), -7)}T00:00:00Z`)),
        ))
        .orderBy(asc(bookings.startsAt)),
    };
  });

  app.get('/coach/messages', async (request) => {
    const coach = requireCoach(request.principal);
    const { db } = request.ctx;

    const threads = await db
      .select({
        thread: messageThreads,
        member: { id: users.id, firstName: users.firstName, lastName: users.lastName, avatarKey: users.avatarKey },
      })
      .from(messageThreads)
      .innerJoin(users, eq(users.id, messageThreads.memberId))
      .where(eq(messageThreads.coachId, coach.coachId))
      .orderBy(desc(messageThreads.lastMessageAt));

    const unread = threads.length > 0
      ? await db
          .select({ threadId: messages.threadId, count: sql<number>`count(*)::int` })
          .from(messages)
          .where(and(
            sql`${messages.threadId} in ${threads.map((t) => t.thread.id)}`,
            sql`${messages.senderId} <> ${coach.userId}`,
            sql`${messages.readAt} is null`,
          ))
          .groupBy(messages.threadId)
      : [];

    const unreadByThread = new Map(unread.map((row) => [row.threadId, row.count]));
    return {
      threads: threads.map((row) => ({ ...row, unread: unreadByThread.get(row.thread.id) ?? 0 })),
    };
  });

  app.get('/coach/analytics', async (request) => {
    const coach = requireCoach(request.principal);
    const { db, today } = request.ctx;
    const weekStart = startOfWeek(today());

    const clients = await db
      .select({ memberId: coachClients.memberId, startedOn: coachClients.startedOn })
      .from(coachClients)
      .where(and(eq(coachClients.coachId, coach.coachId), eq(coachClients.status, 'active')));
    const memberIds = clients.map((c) => c.memberId);

    if (memberIds.length === 0) {
      return { activeClients: 0, weeklyAdherence: 0, retentionWeeks: 0, checkInResponseRate: 0, revenueCents: 0, series: [] };
    }

    const days = await db
      .select({ userId: planDays.userId, date: planDays.date, status: planDays.status, kind: planDays.kind })
      .from(planDays)
      .where(and(
        sql`${planDays.userId} in ${memberIds}`,
        gte(planDays.date, addDays(weekStart, -49)),
        sql`${planDays.kind} <> 'rest'`,
      ));

    const series: { weekStart: string; adherencePercent: number; sessions: number }[] = [];
    for (let offset = 7; offset >= 0; offset -= 1) {
      const start = addDays(weekStart, -offset * 7);
      const end = addDays(start, 6);
      const inWeek = days.filter((d) => d.date >= start && d.date <= end);
      const done = inWeek.filter((d) => d.status === 'completed').length;
      series.push({
        weekStart: start,
        adherencePercent: adherence(done, inWeek.length),
        sessions: done,
      });
    }

    const allCheckIns = await db
      .select({ respondedAt: checkIns.respondedAt })
      .from(checkIns).where(eq(checkIns.coachId, coach.coachId));
    const answered = allCheckIns.filter((c) => c.respondedAt !== null).length;

    const [profile] = await db.select().from(coaches).where(eq(coaches.id, coach.coachId)).limit(1);

    return {
      activeClients: memberIds.length,
      weeklyAdherence: series.at(-1)?.adherencePercent ?? 0,
      retentionWeeks: Math.round(
        clients.reduce((total, c) => total + Math.max(0, daysSince(c.startedOn, today())) / 7, 0) /
          Math.max(1, clients.length),
      ),
      checkInResponseRate: allCheckIns.length > 0 ? Math.round((answered / allCheckIns.length) * 100) : 0,
      revenueCents: memberIds.length * (profile?.monthlyPriceCents ?? 0),
      series,
    };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertClientOf(db: any, coachId: string, memberId: string): Promise<void> {
  const rows = await db
    .select({ id: coachClients.id })
    .from(coachClients)
    .where(and(
      eq(coachClients.coachId, coachId),
      eq(coachClients.memberId, memberId),
      eq(coachClients.status, 'active'),
    ))
    .limit(1);
  if (rows.length === 0) throw forbidden('That member is not one of your clients.');
}

function daysSince(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
