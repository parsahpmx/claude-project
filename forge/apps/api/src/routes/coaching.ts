import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { randomId, scoreCheckIn, startOfWeek, addDays } from '@forge/core';
import {
  bookings, checkIns, coachClients, coaches, coachNotes, formCheckComments,
  messages, messageThreads, recoveryLogs, recoverySessions, users,
} from '@forge/db';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireMember } from '../auth/guards.js';
import { isoDateSchema } from './schemas.js';

export async function registerCoachingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me/coach', async (request) => {
    const principal = requireMember(request.principal);
    const { db, today } = request.ctx;

    const [relationship] = await db
      .select({
        coach: coaches, coachUser: { firstName: users.firstName, lastName: users.lastName },
        startedOn: coachClients.startedOn,
      })
      .from(coachClients)
      .innerJoin(coaches, eq(coaches.id, coachClients.coachId))
      .innerJoin(users, eq(users.id, coaches.userId))
      .where(and(eq(coachClients.memberId, principal.userId), eq(coachClients.status, 'active')))
      .limit(1);

    if (!relationship) return { coach: null };

    const [thread] = await db
      .select().from(messageThreads)
      .where(and(
        eq(messageThreads.memberId, principal.userId),
        eq(messageThreads.coachId, relationship.coach.id),
      ))
      .limit(1);

    const [nextBooking] = await db
      .select().from(bookings)
      .where(and(
        eq(bookings.memberId, principal.userId),
        gte(bookings.startsAt, new Date(`${today()}T00:00:00Z`)),
      ))
      .orderBy(asc(bookings.startsAt))
      .limit(1);

    const history = await db
      .select().from(checkIns)
      .where(eq(checkIns.memberId, principal.userId))
      .orderBy(desc(checkIns.weekStart))
      .limit(12);

    const weekStart = startOfWeek(today());
    const dueThisWeek = !history.some((entry) => entry.weekStart === weekStart);

    const unread = thread
      ? await db
          .select({ count: sql<number>`count(*)::int` })
          .from(messages)
          .where(and(
            eq(messages.threadId, thread.id),
            sql`${messages.senderId} <> ${principal.userId}`,
            sql`${messages.readAt} is null`,
          ))
      : [];

    return {
      coach: {
        ...relationship.coach,
        firstName: relationship.coachUser.firstName,
        lastName: relationship.coachUser.lastName,
      },
      startedOn: relationship.startedOn,
      threadId: thread?.id ?? null,
      unreadMessages: unread[0]?.count ?? 0,
      nextBooking: nextBooking ?? null,
      checkIns: history,
      checkInDueThisWeek: dueThisWeek,
      currentWeekStart: weekStart,
    };
  });

  app.post('/me/coach/select', async (request) => {
    const principal = requireMember(request.principal);
    const body = parse(z.object({ coachSlug: z.string().max(64) }), request.body);
    const { db, today } = request.ctx;

    const [coach] = await db.select().from(coaches).where(eq(coaches.slug, body.coachSlug)).limit(1);
    if (!coach) throw notFound('Coach');
    if (!coach.acceptingClients) {
      throw conflict('coach_full', 'That coach is not taking new clients right now.');
    }

    const existing = await db
      .select({ id: coachClients.id }).from(coachClients)
      .where(and(eq(coachClients.memberId, principal.userId), eq(coachClients.status, 'active')))
      .limit(1);
    if (existing[0]) {
      throw conflict('coach_exists', 'You already have an active coach. End that first.');
    }

    await db.insert(coachClients).values({
      id: randomId('coach'), coachId: coach.id, memberId: principal.userId,
      status: 'active', startedOn: today(),
    });

    const thread = await db
      .select({ id: messageThreads.id }).from(messageThreads)
      .where(and(eq(messageThreads.memberId, principal.userId), eq(messageThreads.coachId, coach.id)))
      .limit(1);

    if (!thread[0]) {
      await db.insert(messageThreads).values({
        id: randomId('thread'), memberId: principal.userId, coachId: coach.id, subject: 'Coaching',
      });
    }

    return { ok: true, coachSlug: coach.slug };
  });

  app.post('/me/coach/check-in', async (request) => {
    const principal = requireMember(request.principal);
    const body = parse(
      z.object({
        weekStart: isoDateSchema.optional(),
        energy: z.number().int().min(1).max(5),
        sleepQuality: z.number().int().min(1).max(5),
        stress: z.number().int().min(1).max(5),
        nutritionAdherence: z.number().int().min(1).max(5),
        trainingAdherence: z.number().int().min(1).max(5),
        weightKg: z.number().min(20).max(400).optional(),
        painNotes: z.string().max(2000).optional(),
        questions: z.string().max(2000).optional(),
        progressPhotoCount: z.number().int().min(0).max(10).default(0),
      }),
      request.body,
    );
    const { db, today } = request.ctx;
    const weekStart = body.weekStart ?? startOfWeek(today());

    const [relationship] = await db
      .select({ coachId: coachClients.coachId })
      .from(coachClients)
      .where(and(eq(coachClients.memberId, principal.userId), eq(coachClients.status, 'active')))
      .limit(1);

    const scored = scoreCheckIn({
      energy: body.energy, sleepQuality: body.sleepQuality, stress: body.stress,
      nutritionAdherence: body.nutritionAdherence, trainingAdherence: body.trainingAdherence,
      ...(body.weightKg !== undefined ? { weightKg: body.weightKg } : {}),
      ...(body.painNotes !== undefined ? { painNotes: body.painNotes } : {}),
      ...(body.questions !== undefined ? { questionsForCoach: body.questions } : {}),
      progressPhotoCount: body.progressPhotoCount,
    });

    const existing = await db
      .select({ id: checkIns.id }).from(checkIns)
      .where(and(eq(checkIns.memberId, principal.userId), eq(checkIns.weekStart, weekStart)))
      .limit(1);

    const values = {
      coachId: relationship?.coachId ?? null,
      energy: body.energy, sleepQuality: body.sleepQuality, stress: body.stress,
      nutritionAdherence: body.nutritionAdherence, trainingAdherence: body.trainingAdherence,
      weightGrams: body.weightKg ? Math.round(body.weightKg * 1000) : null,
      painNotes: body.painNotes ?? null, questions: body.questions ?? null,
      progressPhotoCount: body.progressPhotoCount,
      score: scored.overall, band: scored.band, flags: scored.flags,
      submittedAt: new Date(),
    };

    if (existing[0]) {
      await db.update(checkIns).set(values).where(eq(checkIns.id, existing[0].id));
    } else {
      await db.insert(checkIns).values({
        id: randomId('checkIn'), memberId: principal.userId, weekStart, ...values,
      });
    }

    return { ok: true, score: scored };
  });

  app.get('/me/messages', async (request) => {
    const principal = requireMember(request.principal);
    const { db } = request.ctx;

    const threads = await db
      .select({
        thread: messageThreads, coach: coaches,
        coachUser: { firstName: users.firstName, lastName: users.lastName },
      })
      .from(messageThreads)
      .innerJoin(coaches, eq(coaches.id, messageThreads.coachId))
      .innerJoin(users, eq(users.id, coaches.userId))
      .where(eq(messageThreads.memberId, principal.userId))
      .orderBy(desc(messageThreads.lastMessageAt));

    return { threads };
  });

  app.get('/me/messages/:threadId', async (request) => {
    const principal = requireMember(request.principal);
    const { threadId } = parse(z.object({ threadId: z.string().max(40) }), request.params);
    const { db } = request.ctx;

    const [thread] = await db
      .select().from(messageThreads).where(eq(messageThreads.id, threadId)).limit(1);
    if (!thread) throw notFound('Conversation');

    // Ownership is checked against both sides — a coach reading their own
    // client's thread is legitimate, anybody else is not.
    const [coach] = await db.select().from(coaches).where(eq(coaches.id, thread.coachId)).limit(1);
    const isMember = thread.memberId === principal.userId;
    const isCoach = coach?.userId === principal.userId;
    if (!isMember && !isCoach && principal.role !== 'admin') throw forbidden();

    const rows = await db
      .select().from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(asc(messages.createdAt));

    const commentRows = await db
      .select().from(formCheckComments)
      .where(sql`${formCheckComments.messageId} in ${rows.map((m) => m.id)}`)
      .orderBy(asc(formCheckComments.timestampSeconds));

    await db.update(messages)
      .set({ readAt: new Date() })
      .where(and(
        eq(messages.threadId, threadId),
        sql`${messages.senderId} <> ${principal.userId}`,
        sql`${messages.readAt} is null`,
      ));

    return {
      thread,
      messages: rows.map((message) => ({
        ...message,
        formCheckComments: commentRows.filter((comment) => comment.messageId === message.id),
      })),
    };
  });

  app.post('/me/messages/:threadId', async (request) => {
    const principal = requireMember(request.principal);
    const { threadId } = parse(z.object({ threadId: z.string().max(40) }), request.params);
    const body = parse(
      z.object({
        kind: z.enum(['text', 'voice', 'video', 'photo', 'document', 'form-check']).default('text'),
        body: z.string().max(4000).optional(),
        mediaKey: z.string().max(120).optional(),
        durationSeconds: z.number().int().min(0).max(3600).optional(),
        exerciseId: z.string().max(64).optional(),
      }),
      request.body,
    );
    const { db } = request.ctx;

    const [thread] = await db
      .select().from(messageThreads).where(eq(messageThreads.id, threadId)).limit(1);
    if (!thread) throw notFound('Conversation');

    const [coach] = await db.select().from(coaches).where(eq(coaches.id, thread.coachId)).limit(1);
    const isMember = thread.memberId === principal.userId;
    const isCoach = coach?.userId === principal.userId;
    if (!isMember && !isCoach) throw forbidden();

    if (body.kind === 'text' && !body.body?.trim()) {
      throw badRequest('empty_message', 'A text message needs some text.');
    }
    if (body.kind !== 'text' && !body.mediaKey) {
      throw badRequest('missing_media', 'That message type needs an attachment.');
    }

    const messageId = randomId('message');
    await db.insert(messages).values({
      id: messageId, threadId, senderId: principal.userId, kind: body.kind,
      body: body.body ?? null, mediaKey: body.mediaKey ?? null,
      durationSeconds: body.durationSeconds ?? null, exerciseId: body.exerciseId ?? null,
    });
    await db.update(messageThreads)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(messageThreads.id, threadId));

    return { ok: true, messageId };
  });

  app.post('/me/messages/:threadId/form-check/:messageId/comments', async (request) => {
    const principal = requireMember(request.principal);
    const params = parse(
      z.object({ threadId: z.string().max(40), messageId: z.string().max(40) }),
      request.params,
    );
    const body = parse(
      z.object({ timestampSeconds: z.number().int().min(0).max(3600), body: z.string().min(1).max(1000) }),
      request.body,
    );
    const { db } = request.ctx;

    const [thread] = await db
      .select().from(messageThreads).where(eq(messageThreads.id, params.threadId)).limit(1);
    if (!thread) throw notFound('Conversation');

    const [coach] = await db.select().from(coaches).where(eq(coaches.id, thread.coachId)).limit(1);
    // Only the coach annotates a form check. A member commenting on their own
    // video would look like coaching feedback in the UI, and it is not.
    if (coach?.userId !== principal.userId && principal.role !== 'admin') {
      throw forbidden('Only your coach can add timestamped notes to a form check.');
    }

    const [message] = await db
      .select().from(messages)
      .where(and(eq(messages.id, params.messageId), eq(messages.threadId, params.threadId)))
      .limit(1);
    if (!message || message.kind !== 'form-check') throw notFound('Form check');

    const id = randomId('comment');
    await db.insert(formCheckComments).values({
      id, messageId: params.messageId, authorId: principal.userId,
      timestampSeconds: body.timestampSeconds, body: body.body,
    });
    return { ok: true, id };
  });

  app.get('/me/bookings', async (request) => {
    const principal = requireMember(request.principal);
    const { db } = request.ctx;
    return {
      bookings: await db
        .select({ booking: bookings, coach: coaches })
        .from(bookings)
        .innerJoin(coaches, eq(coaches.id, bookings.coachId))
        .where(eq(bookings.memberId, principal.userId))
        .orderBy(asc(bookings.startsAt)),
    };
  });

  app.post('/me/bookings', async (request) => {
    const principal = requireMember(request.principal);
    const body = parse(
      z.object({
        coachSlug: z.string().max(64),
        kind: z.enum(['30-minute-consultation', '60-minute-coaching', 'form-review']),
        startsAt: z.string().datetime(),
        agenda: z.string().max(1000).optional(),
      }),
      request.body,
    );
    const { db } = request.ctx;

    const [coach] = await db.select().from(coaches).where(eq(coaches.slug, body.coachSlug)).limit(1);
    if (!coach) throw notFound('Coach');

    const startsAt = new Date(body.startsAt);
    if (startsAt.getTime() < Date.now()) {
      throw badRequest('past_booking', 'That time has already passed.');
    }

    const durationMinutes = body.kind === '60-minute-coaching' ? 60 : 30;
    const priceCents = body.kind === '30-minute-consultation'
      ? coach.consultationPriceCents
      : coach.sessionPriceCents;

    const id = randomId('booking');
    await db.insert(bookings).values({
      id, coachId: coach.id, memberId: principal.userId, kind: body.kind,
      startsAt, durationMinutes, status: 'confirmed', priceCents,
      agenda: body.agenda ?? null,
    });

    return { ok: true, bookingId: id, durationMinutes, priceCents };
  });

  app.get('/me/recovery', async (request) => {
    const principal = requireMember(request.principal);
    const { db, today } = request.ctx;
    const date = today();

    const logs = await db
      .select({ log: recoveryLogs, session: recoverySessions })
      .from(recoveryLogs)
      .leftJoin(recoverySessions, eq(recoverySessions.id, recoveryLogs.recoverySessionId))
      .where(and(eq(recoveryLogs.userId, principal.userId), gte(recoveryLogs.date, addDays(date, -28))))
      .orderBy(desc(recoveryLogs.date));

    const catalogue = await db.select().from(recoverySessions).orderBy(asc(recoverySessions.minutes));
    const categories = [...new Set(catalogue.map((session) => session.category))];

    return {
      sessions: catalogue,
      categories,
      logs,
      minutesThisWeek: logs
        .filter((entry) => entry.log.date >= startOfWeek(date))
        .reduce((total, entry) => total + entry.log.minutes, 0),
    };
  });

  app.post('/me/recovery/log', async (request) => {
    const principal = requireMember(request.principal);
    const body = parse(
      z.object({
        slug: z.string().max(64).optional(),
        minutes: z.number().int().min(1).max(180).optional(),
        date: isoDateSchema.optional(),
      }),
      request.body,
    );
    const { db, today } = request.ctx;

    let sessionId: string | null = null;
    let minutes = body.minutes ?? 10;
    if (body.slug) {
      const [session] = await db
        .select().from(recoverySessions).where(eq(recoverySessions.slug, body.slug)).limit(1);
      if (!session) throw notFound('Recovery session');
      sessionId = session.id;
      minutes = body.minutes ?? session.minutes;
    }

    await db.insert(recoveryLogs).values({
      id: randomId('workout'), userId: principal.userId, recoverySessionId: sessionId,
      date: body.date ?? today(), minutes,
    });
    return { ok: true };
  });

  app.get('/me/coach-notes', async (request) => {
    const principal = requireMember(request.principal);
    const { db } = request.ctx;
    // Members only ever see notes their coach chose to share.
    return {
      notes: await db
        .select().from(coachNotes)
        .where(and(eq(coachNotes.memberId, principal.userId), eq(coachNotes.visibility, 'shared')))
        .orderBy(desc(coachNotes.createdAt)),
    };
  });
}
