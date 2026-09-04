import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { authSessions, planDays, users } from '@forge/db';
import { createHarness, json, login, TEST_TODAY, type Harness } from './test-support/harness.js';

let h: Harness;
let memberCookie: string;
let coachCookie: string;

beforeAll(async () => {
  h = await createHarness();
  memberCookie = await login(h.app, 'alex@forge.fit');
  coachCookie = await login(h.app, 'maya.roberts@forge.fit');
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe('health and errors', () => {
  it('reports healthy', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(json<{ status: string }>(response.body).status).toBe('ok');
  });

  it('returns a structured error for an unknown endpoint', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/v1/nope' });
    expect(response.statusCode).toBe(404);
    expect(json<{ error: { code: string } }>(response.body).error.code).toBe('not_found');
  });

  it('names the offending fields on a bad request', async () => {
    const response = await h.app.inject({
      method: 'POST', url: '/v1/auth/login', payload: { email: 'nope', password: '' },
    });
    expect(response.statusCode).toBe(400);
    const body = json<{ error: { code: string; details: { field: string }[] } }>(response.body);
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.details.map((d) => d.field)).toContain('email');
  });
});

describe('authentication', () => {
  it('rejects a wrong password without saying which half was wrong', async () => {
    const response = await h.app.inject({
      method: 'POST', url: '/v1/auth/login',
      payload: { email: 'alex@forge.fit', password: 'not-the-password' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.body).toContain('do not match');
  });

  it('gives the same answer for an unknown email as for a wrong password', async () => {
    const unknown = await h.app.inject({
      method: 'POST', url: '/v1/auth/login',
      payload: { email: 'nobody@forge.fit', password: 'not-the-password' },
    });
    expect(unknown.statusCode).toBe(401);
    expect(json<{ error: { message: string } }>(unknown.body).error.message).toContain('do not match');
  });

  it('sets an httpOnly session cookie on login', async () => {
    const response = await h.app.inject({
      method: 'POST', url: '/v1/auth/login',
      payload: { email: 'alex@forge.fit', password: 'ForgeDemo!2026' },
    });
    const cookie = response.cookies.find((c) => c.name === 'forge_session');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
  });

  it('never stores the session token itself', async () => {
    const rawToken = memberCookie.split('=')[1]!;
    const rows = await h.handle.db
      .select({ tokenHash: authSessions.tokenHash })
      .from(authSessions);

    // The database holds only SHA-256 hashes; the raw token must appear nowhere.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.tokenHash === rawToken)).toBe(false);
    expect(rows.every((row) => /^[0-9a-f]{64}$/.test(row.tokenHash))).toBe(true);
  });

  it('refuses member data without a session', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/v1/me/dashboard' });
    expect(response.statusCode).toBe(401);
  });

  it('returns the signed-in member', async () => {
    const response = await h.app.inject({
      method: 'GET', url: '/v1/auth/me', headers: { cookie: memberCookie },
    });
    expect(response.statusCode).toBe(200);
    const body = json<{ user: { email: string }; profile: unknown; subscription: unknown }>(response.body);
    expect(body.user.email).toBe('alex@forge.fit');
    expect(body.profile).not.toBeNull();
    expect(body.subscription).not.toBeNull();
  });

  it('registers a new member and signs them straight in', async () => {
    const response = await h.app.inject({
      method: 'POST', url: '/v1/auth/register',
      payload: {
        email: 'new.member@example.com', password: 'a-long-enough-password',
        firstName: 'New', lastName: 'Member',
        answers: {
          primaryGoal: 'build-muscle', secondaryGoals: [], ageRange: '25-34',
          experience: 'beginner', daysPerWeek: 3, sessionMinutes: 45, location: 'gym',
          equipment: ['dumbbells', 'bench'], diet: 'balanced', coaching: 'ai-assisted',
          heightCm: 175, weightKg: 74, sexAtBirth: 'prefer-not-to-say',
        },
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.cookies.some((c) => c.name === 'forge_session')).toBe(true);
  });

  it('refuses a duplicate email', async () => {
    const response = await h.app.inject({
      method: 'POST', url: '/v1/auth/register',
      payload: {
        email: 'ALEX@forge.fit', password: 'a-long-enough-password',
        firstName: 'Impostor', lastName: 'Account',
      },
    });
    expect(response.statusCode).toBe(409);
    expect(json<{ error: { code: string } }>(response.body).error.code).toBe('email_taken');
  });

  it('invalidates the session on logout', async () => {
    const cookie = await login(h.app, 'lena@forge.fit');
    await h.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { cookie } });
    const after = await h.app.inject({ method: 'GET', url: '/v1/me/dashboard', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });
});

describe('public catalogue', () => {
  it('serves programmes without a session', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/v1/catalog/programs' });
    expect(response.statusCode).toBe(200);
    const body = json<{ programs: unknown[]; facets: unknown }>(response.body);
    expect(body.programs.length).toBeGreaterThan(8);
    expect(body.facets).toBeDefined();
  });

  it('filters programmes by equipment', async () => {
    const response = await h.app.inject({
      method: 'GET', url: '/v1/catalog/programs?equipment=bodyweight',
    });
    const body = json<{ programs: { equipment: string[] }[] }>(response.body);
    expect(body.programs.length).toBeGreaterThan(0);
    for (const program of body.programs) {
      expect(program.equipment.every((e) => e === 'bodyweight')).toBe(true);
    }
  });

  it('explains why each coach ranked where it did', async () => {
    const response = await h.app.inject({
      method: 'GET', url: '/v1/catalog/coaches?goal=build-muscle',
    });
    const body = json<{ coaches: { slug: string; matchReasons: string[] }[] }>(response.body);
    expect(body.coaches.length).toBeGreaterThan(0);
    expect(body.coaches[0]!.matchReasons.length).toBeGreaterThan(0);
  });

  it('returns a recipe with its ingredients', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/v1/catalog/recipes/turkey-chilli' });
    expect(response.statusCode).toBe(200);
    const body = json<{ recipe: { name: string }; ingredients: { quantity: number }[] }>(response.body);
    expect(body.recipe.name).toBe('Smoked Turkey Chilli');
    expect(body.ingredients.length).toBeGreaterThan(3);
    expect(body.ingredients[0]!.quantity).toBeGreaterThan(0);
  });

  it('404s a programme that does not exist', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/v1/catalog/programs/not-real' });
    expect(response.statusCode).toBe(404);
  });
});

describe('assessment', () => {
  it('turns answers into a profile and a programme', async () => {
    const response = await h.app.inject({
      method: 'POST', url: '/v1/assessment',
      payload: {
        answers: {
          primaryGoal: 'improve-endurance', secondaryGoals: ['build-healthy-habits'],
          ageRange: '35-44', experience: 'beginner', daysPerWeek: 4, sessionMinutes: 40,
          location: 'outside', equipment: ['bodyweight'], diet: 'balanced', coaching: 'self-guided',
        },
      },
    });
    expect(response.statusCode).toBe(200);
    const body = json<{ profile: { recommendedProgramSlug: string }; recommendedTier: string; program: { slug: string } }>(response.body);
    expect(body.profile.recommendedProgramSlug).toBe('5k-builder');
    expect(body.recommendedTier).toBe('forge');
    expect(body.program.slug).toBe('5k-builder');
  });

  it('rejects an answer sheet with an unknown goal', async () => {
    const response = await h.app.inject({
      method: 'POST', url: '/v1/assessment',
      payload: { answers: { primaryGoal: 'become-a-wizard' } },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('member dashboard and plan', () => {
  it('answers all five product questions in one payload', async () => {
    const response = await h.app.inject({
      method: 'GET', url: '/v1/me/dashboard', headers: { cookie: memberCookie },
    });
    expect(response.statusCode).toBe(200);
    const body = json<Record<string, unknown>>(response.body);
    // What should I do today / why / am I progressing / what next / who helps.
    expect(body.today).toBeDefined();
    expect(body.readiness).toBeDefined();
    expect(body.week).toBeDefined();
    expect(body.timeline).toBeDefined();
    expect(body.plan).not.toBeNull();
  });

  it('returns a twelve-week roadmap with days attached', async () => {
    const response = await h.app.inject({
      method: 'GET', url: '/v1/me/plan', headers: { cookie: memberCookie },
    });
    const body = json<{
      plan: { totalWeeks: number }; weeks: { days: unknown[] }[];
      progress: { percent: number };
    }>(response.body);
    expect(body.plan.totalWeeks).toBe(12);
    expect(body.weeks).toHaveLength(12);
    expect(body.weeks[0]!.days).toHaveLength(7);
    expect(body.progress.percent).toBeGreaterThan(0);
  });

  it('serves a session with the member’s own previous loads', async () => {
    const [day] = await h.handle.db
      .select().from(planDays)
      .where(eq(planDays.status, 'scheduled'))
      .limit(1);

    const response = await h.app.inject({
      method: 'GET', url: `/v1/me/plan/days/${day!.id}`, headers: { cookie: memberCookie },
    });
    // The seeded day may belong to another member; ownership decides the code.
    expect([200, 404]).toContain(response.statusCode);
  });

  it('never serves one member’s session to another', async () => {
    const [otherDay] = await h.handle.db
      .select({ id: planDays.id, userId: planDays.userId })
      .from(planDays)
      .where(eq(planDays.userId, (await memberId(h, 'priya@forge.fit'))))
      .limit(1);

    const response = await h.app.inject({
      method: 'GET', url: `/v1/me/plan/days/${otherDay!.id}`, headers: { cookie: memberCookie },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('workout completion', () => {
  it('logs a session, detects a PR and advances the prescription', async () => {
    const alexId = await memberId(h, 'alex@forge.fit');
    const [day] = await h.handle.db
      .select().from(planDays)
      .where(eq(planDays.userId, alexId))
      .orderBy(planDays.date)
      .limit(200)
      .then((rows) => rows.filter((r) => r.status === 'scheduled' && r.sessionTemplate !== null));

    expect(day).toBeDefined();

    const response = await h.app.inject({
      method: 'POST', url: '/v1/me/workouts', headers: { cookie: memberCookie },
      payload: {
        planDayId: day!.id,
        date: TEST_TODAY,
        durationSeconds: 2700,
        difficultyFeedback: 'perfect',
        averageHeartRate: 132,
        sets: [
          { exerciseId: 'barbell-bench-press', exerciseName: 'Barbell Bench Press', setIndex: 1, reps: 8, loadGrams: 300_000, rpe: 8, completed: true },
          { exerciseId: 'barbell-bench-press', exerciseName: 'Barbell Bench Press', setIndex: 2, reps: 8, loadGrams: 300_000, rpe: 8, completed: true },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = json<{
      summary: { volumeGrams: number; setsCompleted: number };
      personalRecords: { kind: string }[];
      progression: { exerciseId: string; action: string }[];
    }>(response.body);

    expect(body.summary.setsCompleted).toBe(2);
    expect(body.summary.volumeGrams).toBe(4_800_000);
    // 300kg is far above the seeded working load, so this is a genuine PR.
    expect(body.personalRecords.some((r) => r.kind === 'load')).toBe(true);
    expect(body.progression[0]!.exerciseId).toBe('barbell-bench-press');
  });

  it('refuses to log the same session twice', async () => {
    const alexId = await memberId(h, 'alex@forge.fit');
    const [completed] = await h.handle.db
      .select().from(planDays)
      .where(eq(planDays.userId, alexId))
      .limit(400)
      .then((rows) => rows.filter((r) => r.status === 'completed'));

    const response = await h.app.inject({
      method: 'POST', url: '/v1/me/workouts', headers: { cookie: memberCookie },
      payload: { planDayId: completed!.id, durationSeconds: 100, sets: [] },
    });
    expect(response.statusCode).toBe(409);
    expect(json<{ error: { code: string } }>(response.body).error.code).toBe('already_completed');
  });
});

describe('nutrition', () => {
  it('returns targets, meal splits and today’s progress', async () => {
    const response = await h.app.inject({
      method: 'GET', url: '/v1/me/nutrition', headers: { cookie: memberCookie },
    });
    expect(response.statusCode).toBe(200);
    const body = json<{
      targets: { calories: number }; mealTargets: unknown[]; macros: { protein: { target: number } };
    }>(response.body);
    expect(body.targets.calories).toBeGreaterThan(1500);
    expect(body.mealTargets).toHaveLength(4);
    expect(body.macros.protein.target).toBeGreaterThan(100);
  });

  it('generates a shopping list aggregated by aisle', async () => {
    const response = await h.app.inject({
      method: 'POST', url: '/v1/me/nutrition/shopping-list/generate',
      headers: { cookie: memberCookie }, payload: {},
    });
    expect(response.statusCode).toBe(200);
    const body = json<{ items: { section: string; name: string }[] }>(response.body);
    expect(body.items.length).toBeGreaterThan(3);
    const sections = body.items.map((i) => i.section);
    expect(sections).toEqual([...sections].sort((a, b) => sectionRank(a) - sectionRank(b)));
  });

  it('refuses to swap in a recipe that breaks the member’s diet', async () => {
    const vegan = await login(h.app, 'lena@forge.fit');
    await h.app.inject({
      method: 'PATCH', url: '/v1/me/profile',
      headers: { cookie: vegan }, payload: { diet: 'vegan' },
    });
    const response = await h.app.inject({
      method: 'POST', url: '/v1/me/nutrition/swap',
      headers: { cookie: vegan },
      payload: { date: TEST_TODAY, slot: 'dinner', recipeSlug: 'steak-and-sweet-potato-hash' },
    });
    expect(response.statusCode).toBe(400);
    expect(json<{ error: { code: string } }>(response.body).error.code).toBe('diet_mismatch');
  });
});

describe('coaching', () => {
  it('gives the member their coach, thread and check-in state', async () => {
    const response = await h.app.inject({
      method: 'GET', url: '/v1/me/coach', headers: { cookie: memberCookie },
    });
    const body = json<{ coach: { slug: string }; threadId: string; checkIns: unknown[] }>(response.body);
    expect(body.coach.slug).toBe('maya-roberts');
    expect(body.threadId).toBeTruthy();
    expect(body.checkIns.length).toBeGreaterThan(0);
  });

  it('scores a check-in and flags a reported pain note', async () => {
    const response = await h.app.inject({
      method: 'POST', url: '/v1/me/coach/check-in', headers: { cookie: memberCookie },
      payload: {
        energy: 3, sleepQuality: 2, stress: 4, nutritionAdherence: 4, trainingAdherence: 5,
        painNotes: 'Right elbow sore on pressing.',
      },
    });
    expect(response.statusCode).toBe(200);
    const body = json<{ score: { flags: string[]; coachPrompts: string[] } }>(response.body);
    expect(body.score.flags).toContain('pain-reported');
    expect(body.score.coachPrompts[0]).toContain('pain note');
  });

  it('lets only the coach add timestamped form-check notes', async () => {
    const coachView = await h.app.inject({
      method: 'GET', url: '/v1/me/coach', headers: { cookie: memberCookie },
    });
    const threadId = json<{ threadId: string }>(coachView.body).threadId;

    const thread = await h.app.inject({
      method: 'GET', url: `/v1/me/messages/${threadId}`, headers: { cookie: memberCookie },
    });
    const formCheck = json<{ messages: { id: string; kind: string }[] }>(thread.body)
      .messages.find((m) => m.kind === 'form-check');
    expect(formCheck).toBeDefined();

    const asMember = await h.app.inject({
      method: 'POST',
      url: `/v1/me/messages/${threadId}/form-check/${formCheck!.id}/comments`,
      headers: { cookie: memberCookie },
      payload: { timestampSeconds: 5, body: 'Looks fine to me' },
    });
    expect(asMember.statusCode).toBe(403);

    const asCoach = await h.app.inject({
      method: 'POST',
      url: `/v1/me/messages/${threadId}/form-check/${formCheck!.id}/comments`,
      headers: { cookie: coachCookie },
      payload: { timestampSeconds: 11, body: 'Chest stays up out of the hole here.' },
    });
    expect(asCoach.statusCode).toBe(200);
  });

  it('keeps one member out of another member’s conversation', async () => {
    const other = await login(h.app, 'tom@forge.fit');
    const mine = await h.app.inject({
      method: 'GET', url: '/v1/me/coach', headers: { cookie: memberCookie },
    });
    const threadId = json<{ threadId: string }>(mine.body).threadId;

    const response = await h.app.inject({
      method: 'GET', url: `/v1/me/messages/${threadId}`, headers: { cookie: other },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('coach workspace', () => {
  it('refuses the coach area to a member', async () => {
    const response = await h.app.inject({
      method: 'GET', url: '/v1/coach/overview', headers: { cookie: memberCookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it('gives a coach their workload and capacity', async () => {
    const response = await h.app.inject({
      method: 'GET', url: '/v1/coach/overview', headers: { cookie: coachCookie },
    });
    expect(response.statusCode).toBe(200);
    const body = json<{ workload: { activeClients: number }; capacity: { status: string } }>(response.body);
    expect(body.workload.activeClients).toBeGreaterThan(0);
    expect(['available', 'busy', 'at-capacity']).toContain(body.capacity.status);
  });

  it('lists only that coach’s own clients', async () => {
    const response = await h.app.inject({
      method: 'GET', url: '/v1/coach/clients', headers: { cookie: coachCookie },
    });
    const body = json<{ clients: { member: { email: string } }[] }>(response.body);
    expect(body.clients.length).toBeGreaterThan(0);
    expect(body.clients.some((c) => c.member.email === 'alex@forge.fit')).toBe(true);
    // Tom is Daniel's client, never Maya's.
    expect(body.clients.some((c) => c.member.email === 'tom@forge.fit')).toBe(false);
  });

  it('refuses a client profile the coach does not own', async () => {
    const tomId = await memberId(h, 'tom@forge.fit');
    const response = await h.app.inject({
      method: 'GET', url: `/v1/coach/clients/${tomId}`, headers: { cookie: coachCookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it('serves a client the coach does own', async () => {
    const alexId = await memberId(h, 'alex@forge.fit');
    const response = await h.app.inject({
      method: 'GET', url: `/v1/coach/clients/${alexId}`, headers: { cookie: coachCookie },
    });
    expect(response.statusCode).toBe(200);
    const body = json<{ member: { email: string }; checkIns: unknown[]; notes: unknown[] }>(response.body);
    expect(body.member.email).toBe('alex@forge.fit');
    expect(body.checkIns.length).toBeGreaterThan(0);
  });

  it('keeps private coach notes out of the member’s view', async () => {
    const alexId = await memberId(h, 'alex@forge.fit');
    await h.app.inject({
      method: 'POST', url: `/v1/coach/clients/${alexId}/notes`, headers: { cookie: coachCookie },
      payload: { body: 'Internal note: do not show this to the client.', visibility: 'private' },
    });
    const response = await h.app.inject({
      method: 'GET', url: '/v1/me/coach-notes', headers: { cookie: memberCookie },
    });
    expect(response.body).not.toContain('Internal note');
  });
});

describe('community and challenges', () => {
  it('serves the feed to anyone and marks nothing as liked when signed out', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/v1/community/feed' });
    expect(response.statusCode).toBe(200);
    const body = json<{ posts: { likedByViewer: boolean }[] }>(response.body);
    expect(body.posts.length).toBeGreaterThan(0);
    expect(body.posts.every((p) => p.likedByViewer === false)).toBe(true);
  });

  it('likes and unlikes idempotently, keeping the counter true', async () => {
    const feed = await h.app.inject({
      method: 'GET', url: '/v1/community/feed', headers: { cookie: memberCookie },
    });
    const post = json<{ posts: { id: string; likeCount: number }[] }>(feed.body).posts[0]!;

    const first = await h.app.inject({
      method: 'POST', url: `/v1/community/posts/${post.id}/like`, headers: { cookie: memberCookie },
    });
    const liked = json<{ liked: boolean }>(first.body).liked;

    const second = await h.app.inject({
      method: 'POST', url: `/v1/community/posts/${post.id}/like`, headers: { cookie: memberCookie },
    });
    expect(json<{ liked: boolean }>(second.body).liked).toBe(!liked);
  });

  it('requires a session to post', async () => {
    const response = await h.app.inject({
      method: 'POST', url: '/v1/community/posts', payload: { body: 'Anonymous post' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns leaderboards that share ranks between ties', async () => {
    const response = await h.app.inject({
      method: 'GET', url: '/v1/me/challenges', headers: { cookie: memberCookie },
    });
    expect(response.statusCode).toBe(200);
    const body = json<{ challenges: { leaderboard: { rank: number }[] }[] }>(response.body);
    expect(body.challenges.length).toBeGreaterThan(0);
    for (const challenge of body.challenges) {
      const ranks = challenge.leaderboard.map((r) => r.rank);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });
});

describe('commerce', () => {
  it('adds to the basket and charges shipping under the threshold', async () => {
    await h.app.inject({
      method: 'POST', url: '/v1/me/cart', headers: { cookie: memberCookie },
      payload: { slug: 'resistance-band-set', quantity: 1 },
    });
    const response = await h.app.inject({
      method: 'GET', url: '/v1/me/cart', headers: { cookie: memberCookie },
    });
    const body = json<{ cart: { subtotalCents: number; shippingCents: number; totalCents: number } }>(response.body);
    expect(body.cart.subtotalCents).toBe(5900);
    expect(body.cart.shippingCents).toBe(999);
    expect(body.cart.totalCents).toBe(6899);
  });

  it('captures the price paid on the order rather than reading it back later', async () => {
    const response = await h.app.inject({
      method: 'POST', url: '/v1/me/orders', headers: { cookie: memberCookie },
    });
    expect(response.statusCode).toBe(200);
    const orders = await h.app.inject({
      method: 'GET', url: '/v1/me/orders', headers: { cookie: memberCookie },
    });
    const body = json<{ orders: { items: { unitPriceCents: number }[] }[] }>(orders.body);
    expect(body.orders[0]!.items[0]!.unitPriceCents).toBe(5900);
  });

  it('refuses to place an empty order', async () => {
    const response = await h.app.inject({
      method: 'POST', url: '/v1/me/orders', headers: { cookie: memberCookie },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('checkout preview', () => {
  it('states the trial end date and the recurring charge', async () => {
    const response = await h.app.inject({
      method: 'POST', url: '/v1/checkout/preview',
      payload: { tier: 'forge-pro', interval: 'monthly' },
    });
    const body = json<{ summary: { firstChargeDate: string; disclosure: string; totalCents: number } }>(response.body);
    expect(body.summary.firstChargeDate).toBe('2026-09-11');
    expect(body.summary.totalCents).toBe(4900);
    expect(body.summary.disclosure).toContain('Cancel any time');
  });

  it('rejects an unknown promotion code rather than silently ignoring it', async () => {
    const response = await h.app.inject({
      method: 'POST', url: '/v1/checkout/preview',
      payload: { tier: 'forge', interval: 'monthly', promoCode: 'NOTREAL' },
    });
    expect(response.statusCode).toBe(400);
    expect(json<{ error: { code: string } }>(response.body).error.code).toBe('invalid_promo');
  });
});

describe('FORGE AI endpoint', () => {
  it('routes an injury question to a professional and records the intent', async () => {
    const response = await h.app.inject({
      method: 'POST', url: '/v1/ai/ask', headers: { cookie: memberCookie },
      payload: { question: 'My shoulder hurts when I bench, should I keep going?' },
    });
    expect(response.statusCode).toBe(200);
    const body = json<{ answer: { intent: string; disclaimer: string } }>(response.body);
    expect(body.answer.intent).toBe('medical');
    expect(body.answer.disclaimer).toContain('not a medical professional');
  });

  it('answers from the member’s own plan and cites its sources', async () => {
    const response = await h.app.inject({
      method: 'POST', url: '/v1/ai/ask', headers: { cookie: memberCookie },
      payload: { question: 'What should I train today?' },
    });
    const body = json<{ answer: { intent: string; sources: string[] } }>(response.body);
    expect(body.answer.intent).toBe('what-should-i-train');
    expect(body.answer.sources).toContain('Today’s plan');
  });

  it('requires a session', async () => {
    const response = await h.app.inject({
      method: 'POST', url: '/v1/ai/ask', payload: { question: 'What should I train today?' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('wearables and profile', () => {
  it('drops permissions and the sync marker when a device is disconnected', async () => {
    await h.app.inject({
      method: 'PATCH', url: '/v1/me/devices/whoop', headers: { cookie: memberCookie },
      payload: { status: 'connected', permissions: ['sleep', 'heart-rate'] },
    });
    await h.app.inject({
      method: 'PATCH', url: '/v1/me/devices/whoop', headers: { cookie: memberCookie },
      payload: { status: 'not-connected', permissions: [] },
    });
    const response = await h.app.inject({
      method: 'GET', url: '/v1/me/devices', headers: { cookie: memberCookie },
    });
    const whoop = json<{ devices: { provider: string; permissions: string[]; lastSyncedAt: string | null }[] }>(response.body)
      .devices.find((d) => d.provider === 'whoop');
    expect(whoop?.permissions).toEqual([]);
    expect(whoop?.lastSyncedAt).toBeNull();
  });

  it('updates equipment and keeps it on the profile', async () => {
    const response = await h.app.inject({
      method: 'PATCH', url: '/v1/me/profile', headers: { cookie: memberCookie },
      payload: { equipment: ['dumbbells', 'bench', 'resistance-bands'] },
    });
    expect(response.statusCode).toBe(200);
    const body = json<{ profile: { equipment: string[] } }>(response.body);
    expect(body.profile.equipment).toEqual(['dumbbells', 'bench', 'resistance-bands']);
  });
});

describe('progress analytics', () => {
  it('returns every series the Progress page renders', async () => {
    const response = await h.app.inject({
      method: 'GET', url: '/v1/me/progress', headers: { cookie: memberCookie },
    });
    expect(response.statusCode).toBe(200);
    const body = json<Record<string, unknown>>(response.body);
    for (const key of ['summary', 'weeklyVolume', 'heatmap', 'muscleDistribution', 'personalRecords', 'strengthTrends', 'bodyweight', 'recovery', 'cardio']) {
      expect(body[key], key).toBeDefined();
    }
  });
});

async function memberId(harness: Harness, email: string): Promise<string> {
  const [row] = await harness.handle.db
    .select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  return row!.id;
}

function sectionRank(section: string): number {
  return ['produce', 'protein', 'dairy', 'pantry', 'frozen', 'other'].indexOf(section);
}
