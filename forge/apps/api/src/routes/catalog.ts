import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { asc, desc, eq, sql } from 'drizzle-orm';
import {
  ASSESSMENT_STEPS, CHALLENGES, EQUIPMENT_LABELS, EXERCISE_LIBRARY, GOAL_LABELS,
  PLANS, PROGRAMS, TRAINING_STYLE_LABELS, filterPrograms, findChallenge, findProgram,
  matchCoaches, planPricing, randomId, type CoachSpecialty, type Equipment,
} from '@forge/core';
import {
  articles, coachApplications, coaches, coachReviews, groups, products, recipes,
  recipeIngredients, recoverySessions, successStories, users,
} from '@forge/db';
import { notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

/**
 * The public catalogue. Everything here is readable without a session — it is
 * what the marketing site renders, and gating it would make the funnel
 * unindexable and unshareable.
 */
export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/catalog/assessment-steps', async () => ({
    steps: ASSESSMENT_STEPS,
    totalSteps: ASSESSMENT_STEPS.length,
  }));

  app.get('/catalog/plans', async () => ({
    plans: PLANS.map((plan) => ({ ...plan, pricing: planPricing(plan) })),
  }));

  app.get('/catalog/programs', async (request) => {
    const query = parse(
      z.object({
        goal: z.string().optional(), difficulty: z.string().optional(),
        style: z.string().optional(), location: z.string().optional(),
        maxSessionMinutes: z.coerce.number().int().optional(),
        equipment: z.string().optional(), search: z.string().optional(),
      }),
      request.query,
    );

    const results = filterPrograms({
      goal: query.goal as never, difficulty: query.difficulty as never,
      style: query.style as never, location: query.location as never,
      maxSessionMinutes: query.maxSessionMinutes,
      equipment: query.equipment ? (query.equipment.split(',') as Equipment[]) : undefined,
      search: query.search,
    });

    return {
      programs: results,
      total: results.length,
      facets: {
        goals: Object.entries(GOAL_LABELS).map(([value, label]) => ({ value, label })),
        styles: Object.entries(TRAINING_STYLE_LABELS).map(([value, label]) => ({ value, label })),
        equipment: Object.entries(EQUIPMENT_LABELS).map(([value, label]) => ({ value, label })),
        durations: [5, 10, 15, 20, 30, 45, 60],
      },
    };
  });

  app.get('/catalog/programs/:slug', async (request) => {
    const { slug } = parse(z.object({ slug: z.string() }), request.params);
    const program = findProgram(slug);
    if (!program) throw notFound('Programme');

    const { db } = request.ctx;
    const [coach] = await db
      .select({
        slug: coaches.slug, headline: coaches.headline, imageKey: coaches.imageKey,
        ratingTenths: coaches.ratingTenths, firstName: users.firstName, lastName: users.lastName,
        yearsExperience: coaches.yearsExperience,
      })
      .from(coaches)
      .innerJoin(users, eq(users.id, coaches.userId))
      .where(eq(coaches.slug, program.coachSlug))
      .limit(1);

    const reviews = coach
      ? await db
          .select({
            rating: coachReviews.rating, body: coachReviews.body,
            firstName: users.firstName, createdAt: coachReviews.createdAt,
          })
          .from(coachReviews)
          .innerJoin(users, eq(users.id, coachReviews.memberId))
          .innerJoin(coaches, eq(coaches.id, coachReviews.coachId))
          .where(eq(coaches.slug, program.coachSlug))
          .limit(4)
      : [];

    return {
      program,
      coach: coach ?? null,
      reviews,
      related: PROGRAMS.filter((p) => p.slug !== slug && p.goals[0] === program.goals[0]).slice(0, 3),
    };
  });

  app.get('/catalog/exercises', async (request) => {
    const query = parse(
      z.object({ equipment: z.string().optional(), pattern: z.string().optional() }),
      request.query,
    );
    const owned = query.equipment ? (query.equipment.split(',') as Equipment[]) : null;
    return {
      exercises: EXERCISE_LIBRARY.filter((exercise) => {
        if (query.pattern && exercise.pattern !== query.pattern) return false;
        if (owned) {
          const available = new Set<string>([...owned, 'bodyweight']);
          if (owned.includes('full-gym')) {
            for (const item of ['dumbbells', 'barbell', 'bench', 'rack', 'kettlebell', 'resistance-bands', 'cable-machine', 'cardio-equipment']) {
              available.add(item);
            }
          }
          return exercise.requires.every((r) => available.has(r));
        }
        return true;
      }),
    };
  });

  app.get('/catalog/challenges', async (request) => {
    const { db } = request.ctx;
    const counts = await db
      .select({ slug: sql<string>`challenge_slug`, participants: sql<number>`count(*)::int` })
      .from(sql`challenge_participants`)
      .groupBy(sql`challenge_slug`);
    const byslug = new Map(counts.map((row) => [row.slug, row.participants]));
    return {
      challenges: CHALLENGES.map((challenge) => ({
        ...challenge,
        participants: byslug.get(challenge.slug) ?? 0,
      })),
    };
  });

  app.get('/catalog/challenges/:slug', async (request) => {
    const { slug } = parse(z.object({ slug: z.string() }), request.params);
    const challenge = findChallenge(slug);
    if (!challenge) throw notFound('Challenge');
    return { challenge };
  });

  app.get('/catalog/coaches', async (request) => {
    const query = parse(
      z.object({
        goal: z.string().optional(), specialty: z.string().optional(),
        language: z.string().optional(), maxMonthlyPriceCents: z.coerce.number().optional(),
        minRating: z.coerce.number().optional(), availableOnly: z.coerce.boolean().optional(),
      }),
      request.query,
    );
    const { db } = request.ctx;

    const rows = await db
      .select({
        id: coaches.id, slug: coaches.slug, headline: coaches.headline,
        specialties: coaches.specialties, languages: coaches.languages,
        yearsExperience: coaches.yearsExperience, ratingTenths: coaches.ratingTenths,
        reviewCount: coaches.reviewCount, clientCount: coaches.clientCount,
        availableSlotsThisWeek: coaches.availableSlotsThisWeek,
        monthlyPriceCents: coaches.monthlyPriceCents, imageKey: coaches.imageKey,
        acceptingClients: coaches.acceptingClients,
        firstName: users.firstName, lastName: users.lastName,
      })
      .from(coaches)
      .innerJoin(users, eq(users.id, coaches.userId))
      .orderBy(desc(coaches.ratingTenths));

    if (!query.goal) {
      const filtered = rows.filter((coach) => {
        if (query.specialty && !coach.specialties.includes(query.specialty)) return false;
        if (query.language && !coach.languages.includes(query.language)) return false;
        if (query.maxMonthlyPriceCents && coach.monthlyPriceCents > query.maxMonthlyPriceCents) return false;
        if (query.minRating && coach.ratingTenths / 10 < query.minRating) return false;
        if (query.availableOnly && coach.availableSlotsThisWeek <= 0) return false;
        return true;
      });
      return { coaches: filtered.map((coach) => ({ ...coach, matchReasons: [] as string[] })) };
    }

    // With a goal supplied the marketplace ranks and explains itself.
    const matches = matchCoaches(
      rows.map((coach) => ({
        slug: coach.slug, specialties: coach.specialties as CoachSpecialty[],
        languages: coach.languages, yearsExperience: coach.yearsExperience,
        rating: coach.ratingTenths / 10, clientCount: coach.clientCount,
        availableSlotsThisWeek: coach.availableSlotsThisWeek,
        monthlyPriceCents: coach.monthlyPriceCents,
      })),
      {
        goal: query.goal as never,
        language: query.language,
        maxMonthlyPriceCents: query.maxMonthlyPriceCents,
        minRating: query.minRating,
        needsAvailabilityThisWeek: query.availableOnly === true,
        preferredSpecialties: query.specialty ? [query.specialty as CoachSpecialty] : undefined,
      },
    );

    const bySlug = new Map(rows.map((coach) => [coach.slug, coach]));
    return {
      coaches: matches
        .map((match) => {
          const coach = bySlug.get(match.slug);
          return coach ? { ...coach, matchScore: match.score, matchReasons: match.reasons } : null;
        })
        .filter((coach): coach is NonNullable<typeof coach> => coach !== null),
    };
  });

  app.get('/catalog/coaches/:slug', async (request) => {
    const { slug } = parse(z.object({ slug: z.string() }), request.params);
    const { db } = request.ctx;

    const [coach] = await db
      .select({
        id: coaches.id, slug: coaches.slug, headline: coaches.headline, bio: coaches.bio,
        philosophy: coaches.philosophy, specialties: coaches.specialties,
        languages: coaches.languages, certifications: coaches.certifications,
        yearsExperience: coaches.yearsExperience, ratingTenths: coaches.ratingTenths,
        reviewCount: coaches.reviewCount, clientCount: coaches.clientCount,
        availableSlotsThisWeek: coaches.availableSlotsThisWeek,
        acceptingClients: coaches.acceptingClients,
        monthlyPriceCents: coaches.monthlyPriceCents,
        consultationPriceCents: coaches.consultationPriceCents,
        sessionPriceCents: coaches.sessionPriceCents, imageKey: coaches.imageKey,
        firstName: users.firstName, lastName: users.lastName,
      })
      .from(coaches)
      .innerJoin(users, eq(users.id, coaches.userId))
      .where(eq(coaches.slug, slug))
      .limit(1);
    if (!coach) throw notFound('Coach');

    const reviews = await db
      .select({
        rating: coachReviews.rating, body: coachReviews.body,
        firstName: users.firstName, createdAt: coachReviews.createdAt,
      })
      .from(coachReviews)
      .innerJoin(users, eq(users.id, coachReviews.memberId))
      .where(eq(coachReviews.coachId, coach.id))
      .limit(8);

    return {
      coach,
      reviews,
      programs: PROGRAMS.filter((p) => p.coachSlug === slug),
      stories: await db.select().from(successStories).where(eq(successStories.coachSlug, slug)),
    };
  });

  app.get('/catalog/recipes', async (request) => {
    const query = parse(
      z.object({ diet: z.string().optional(), slot: z.string().optional(), search: z.string().optional() }),
      request.query,
    );
    const { db } = request.ctx;
    const rows = await db.select().from(recipes).orderBy(asc(recipes.name));
    return {
      recipes: rows.filter((recipe) => {
        if (query.slot && recipe.slot !== query.slot) return false;
        if (query.diet && query.diet !== 'balanced' && !recipe.tags.includes(query.diet)) return false;
        if (query.search && !`${recipe.name} ${recipe.summary}`.toLowerCase().includes(query.search.toLowerCase())) return false;
        return true;
      }),
    };
  });

  app.get('/catalog/recipes/:slug', async (request) => {
    const { slug } = parse(z.object({ slug: z.string() }), request.params);
    const { db } = request.ctx;
    const [recipe] = await db.select().from(recipes).where(eq(recipes.slug, slug)).limit(1);
    if (!recipe) throw notFound('Recipe');
    const ingredients = await db
      .select().from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, recipe.id))
      .orderBy(asc(recipeIngredients.position));
    return { recipe, ingredients: ingredients.map(toIngredient) };
  });

  app.get('/catalog/recovery', async (request) => {
    const { db } = request.ctx;
    return { sessions: await db.select().from(recoverySessions).orderBy(asc(recoverySessions.minutes)) };
  });

  app.get('/catalog/articles', async (request) => {
    const query = parse(z.object({ category: z.string().optional() }), request.query);
    const { db } = request.ctx;
    const rows = await db.select().from(articles).orderBy(desc(articles.publishedOn));
    const filtered = query.category ? rows.filter((a) => a.category === query.category) : rows;
    return {
      articles: filtered.map(({ body, ...rest }) => { void body; return rest; }),
      categories: [...new Set(rows.map((a) => a.category))],
    };
  });

  app.get('/catalog/articles/:slug', async (request) => {
    const { slug } = parse(z.object({ slug: z.string() }), request.params);
    const { db } = request.ctx;
    const [article] = await db.select().from(articles).where(eq(articles.slug, slug)).limit(1);
    if (!article) throw notFound('Article');
    return { article };
  });

  app.get('/catalog/stories', async (request) => {
    const { db } = request.ctx;
    return { stories: await db.select().from(successStories) };
  });

  app.get('/catalog/stories/:slug', async (request) => {
    const { slug } = parse(z.object({ slug: z.string() }), request.params);
    const { db } = request.ctx;
    const [story] = await db.select().from(successStories).where(eq(successStories.slug, slug)).limit(1);
    if (!story) throw notFound('Story');
    return { story };
  });

  app.get('/catalog/products', async (request) => {
    const query = parse(
      z.object({ category: z.string().optional(), goal: z.string().optional() }),
      request.query,
    );
    const { db } = request.ctx;
    const rows = await db.select().from(products).orderBy(desc(products.ratingTenths));
    return {
      products: rows.filter((product) => {
        if (query.category && product.category !== query.category) return false;
        if (query.goal && !product.goals.includes(query.goal)) return false;
        return true;
      }),
      categories: [...new Set(rows.map((p) => p.category))],
    };
  });

  app.get('/catalog/products/:slug', async (request) => {
    const { slug } = parse(z.object({ slug: z.string() }), request.params);
    const { db } = request.ctx;
    const [product] = await db.select().from(products).where(eq(products.slug, slug)).limit(1);
    if (!product) throw notFound('Product');
    return {
      product: { ...product, specs: safeJson(product.specs) },
      compatiblePrograms: PROGRAMS.filter((p) => product.compatiblePrograms.includes(p.slug)),
    };
  });

  /**
   * Coach applications are open: somebody who wants to coach on FORGE has no
   * account yet, and requiring one before they can apply loses the best of them.
   */
  app.post('/coach-applications', async (request, reply) => {
    const body = parse(
      z.object({
        fullName: z.string().trim().min(2).max(160),
        email: z.string().trim().toLowerCase().email().max(320),
        certifications: z.string().trim().min(3).max(2000),
        yearsExperience: z.number().int().min(0).max(60),
        specialties: z.array(z.string().max(40)).min(1).max(12),
        about: z.string().trim().min(40).max(4000),
      }),
      request.body,
    );

    await request.ctx.db.insert(coachApplications).values({
      id: randomId('coach'),
      fullName: body.fullName,
      email: body.email,
      certifications: body.certifications,
      yearsExperience: body.yearsExperience,
      specialties: body.specialties,
      about: body.about,
      status: 'submitted',
    });

    return reply.status(201).send({ ok: true });
  });

  app.get('/catalog/groups', async (request) => {
    const { db } = request.ctx;
    return { groups: await db.select().from(groups).orderBy(desc(groups.memberCount)) };
  });
}

function toIngredient(row: { name: string; quantityCenti: number; unit: string; section: string }) {
  return { name: row.name, quantity: row.quantityCenti / 100, unit: row.unit, section: row.section };
}

function safeJson(value: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}
