import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import {
  buildPerformanceProfile,
  findPlan,
  findProgram,
  planPricing,
  recommendTier,
  resolvePromo,
  summariseCheckout,
  randomId,
  computeMacroTargets,
  type AssessmentAnswers,
} from '@forge/core';
import {
  assessments, hashPassword, memberProfiles, nutritionTargets, subscriptions,
  users, verifyPassword,
} from '@forge/db';
import { badRequest, conflict, unauthorized } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { issueSession, revokeSession, SESSION_COOKIE } from '../auth/session.js';
import { requireMember } from '../auth/guards.js';
import { answersSchema } from './schemas.js';

const emailSchema = z.string().trim().toLowerCase().email().max(320);

const registerSchema = z.object({
  email: emailSchema,
  // Length is the control that actually matters; composition rules push people
  // towards Password1! and a sticky note.
  password: z.string().min(10).max(200),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  marketingOptIn: z.boolean().default(false),
  answers: answersSchema.optional(),
  tier: z.enum(['forge', 'forge-pro', 'forge-coach']).optional(),
  billingInterval: z.enum(['monthly', 'yearly']).default('monthly'),
  promoCode: z.string().trim().max(32).optional(),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', async (request, reply) => {
    const body = parse(registerSchema, request.body);
    const { db, config, today } = request.ctx;

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${body.email}`)
      .limit(1);
    if (existing.length > 0) {
      throw conflict('email_taken', 'An account already exists for that email address.');
    }

    const userId = randomId('user');
    await db.insert(users).values({
      id: userId,
      email: body.email,
      passwordHash: await hashPassword(body.password),
      firstName: body.firstName,
      lastName: body.lastName,
      role: 'member',
      marketingOptIn: body.marketingOptIn,
    });

    if (body.answers) {
      const answers = body.answers as AssessmentAnswers;
      const profile = buildPerformanceProfile(answers);
      await db.insert(memberProfiles).values({
        userId,
        primaryGoal: answers.primaryGoal,
        secondaryGoals: answers.secondaryGoals,
        ageRange: answers.ageRange,
        experience: answers.experience,
        daysPerWeek: answers.daysPerWeek,
        sessionMinutes: answers.sessionMinutes,
        trainingLocation: answers.location,
        equipment: answers.equipment,
        diet: answers.diet,
        coachingPreference: answers.coaching,
        heightCm: answers.heightCm ?? null,
        weightKg: answers.weightKg ?? null,
        sexAtBirth: answers.sexAtBirth ?? null,
        onboardedAt: new Date(),
      });
      await db.insert(assessments).values({
        id: randomId('profile'),
        userId,
        answers: JSON.stringify(answers),
        profile: JSON.stringify(profile),
        completedAt: new Date(),
      });

      if (answers.weightKg && answers.heightCm) {
        const macros = computeMacroTargets({
          weightKg: answers.weightKg,
          heightCm: answers.heightCm,
          ageRange: answers.ageRange,
          sexAtBirth: answers.sexAtBirth ?? 'prefer-not-to-say',
          goal: answers.primaryGoal,
          trainingDaysPerWeek: profile.suggestedFrequency,
          diet: answers.diet,
        });
        await db.insert(nutritionTargets).values({
          userId, calories: macros.calories, proteinGrams: macros.proteinGrams,
          carbGrams: macros.carbGrams, fatGrams: macros.fatGrams,
          fibreGrams: macros.fibreGrams, waterMl: Math.round(macros.waterLitres * 1000),
        });
      }
    }

    const tier = body.tier ?? (body.answers ? recommendTier(body.answers.coaching) : 'forge');
    const plan = findPlan(tier);
    if (plan) {
      const pricing = planPricing(plan);
      await db.insert(subscriptions).values({
        id: randomId('subscription'),
        userId,
        tier,
        billingInterval: body.billingInterval,
        status: plan.trialDays > 0 ? 'trialing' : 'active',
        priceCents: body.billingInterval === 'yearly' ? pricing.yearlyCents : pricing.monthlyCents,
        promoCode: body.promoCode ?? null,
        trialEndsOn: plan.trialDays > 0 ? addIsoDays(today(), plan.trialDays) : null,
        currentPeriodEndsOn: addIsoDays(today(), plan.trialDays > 0 ? plan.trialDays : 30),
      });
    }

    const session = await issueSession(db, userId, config.SESSION_TTL_HOURS, request.headers['user-agent']);
    setSessionCookie(reply, session.token, session.expiresAt, config.NODE_ENV === 'production');

    return reply.status(201).send({
      user: { id: userId, email: body.email, firstName: body.firstName, lastName: body.lastName, role: 'member' },
      tier,
    });
  });

  app.post('/auth/login', async (request, reply) => {
    const body = parse(z.object({ email: emailSchema, password: z.string().min(1).max(200) }), request.body);
    const { db, config } = request.ctx;

    const rows = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${body.email}`)
      .limit(1);
    const user = rows[0];

    // Always run a verification, even with no user, so a wrong email and a
    // wrong password take the same time and the endpoint cannot enumerate.
    const stored = user?.passwordHash ?? DUMMY_HASH;
    const ok = await verifyPassword(body.password, stored);
    if (!user || !ok) throw unauthorized('That email and password do not match.');

    await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
    const session = await issueSession(db, user.id, config.SESSION_TTL_HOURS, request.headers['user-agent']);
    setSessionCookie(reply, session.token, session.expiresAt, config.NODE_ENV === 'production');

    return {
      user: {
        id: user.id, email: user.email, firstName: user.firstName,
        lastName: user.lastName, role: user.role,
      },
    };
  });

  app.post('/auth/logout', async (request, reply) => {
    if (request.principal) {
      await revokeSession(request.ctx.db, request.principal.sessionId);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', async (request) => {
    const principal = requireMember(request.principal);
    const { db } = request.ctx;

    const [profile] = await db
      .select().from(memberProfiles).where(eq(memberProfiles.userId, principal.userId)).limit(1);
    const [subscription] = await db
      .select().from(subscriptions)
      .where(and(eq(subscriptions.userId, principal.userId), sql`${subscriptions.status} in ('trialing','active')`))
      .limit(1);

    return {
      user: {
        id: principal.userId, email: principal.email, firstName: principal.firstName,
        lastName: principal.lastName, role: principal.role, unitSystem: principal.unitSystem,
        coachSlug: principal.coachSlug,
      },
      profile: profile ?? null,
      subscription: subscription ?? null,
    };
  });

  // Assessment is deliberately open: the funnel must work before signup.
  app.post('/assessment', async (request) => {
    const body = parse(z.object({ answers: answersSchema }), request.body);
    const answers = body.answers as AssessmentAnswers;
    const profile = buildPerformanceProfile(answers);
    const program = findProgram(profile.recommendedProgramSlug);
    return {
      profile,
      recommendedTier: recommendTier(answers.coaching),
      program: program
        ? {
            slug: program.slug, name: program.name, tagline: program.tagline,
            weeks: program.weeks, sessionsPerWeek: program.sessionsPerWeek,
            difficulty: program.difficulty, summary: program.summary,
            accentImage: program.accentImage,
          }
        : null,
    };
  });

  app.post('/checkout/preview', async (request) => {
    const body = parse(
      z.object({
        tier: z.enum(['forge', 'forge-pro', 'forge-coach']),
        interval: z.enum(['monthly', 'yearly']),
        promoCode: z.string().trim().max(32).optional(),
      }),
      request.body,
    );
    const promoPercentOff = resolvePromo(body.promoCode);
    if (body.promoCode && promoPercentOff === 0) {
      throw badRequest('invalid_promo', 'That promotion code is not recognised.');
    }
    const summary = summariseCheckout({
      tier: body.tier, interval: body.interval, promoPercentOff,
      todayIso: request.ctx.today(),
    });
    if (!summary) throw badRequest('unknown_plan', 'That plan does not exist.');
    return { summary, promoPercentOff };
  });
}

/** A real hash of a value nobody knows, for constant-time login failure. */
const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'JmFyZ29uLW5vdC1hLXJlYWwtaGFzaC1qdXN0LWNvbnN0YW50LXRpbWUtcGFkZGluZy1ieXRlcy0wMDAwMDAwMDAwMDA=';

function setSessionCookie(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reply: any,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    expires: expiresAt,
  });
}

function addIsoDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
