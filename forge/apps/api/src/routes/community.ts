import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  buildLeaderboard, challengeProgress, CHALLENGES, daysBetween, findChallenge, randomId,
} from '@forge/core';
import {
  challengeParticipants, follows, groups, postComments, postLikes, posts, postSaves, users,
} from '@forge/db';
import { conflict, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireMember } from '../auth/guards.js';
import { paginationSchema } from './schemas.js';

export async function registerCommunityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/community/feed', async (request) => {
    const query = parse(
      paginationSchema.extend({ group: z.string().max(48).optional() }),
      request.query,
    );
    const { db } = request.ctx;
    const viewerId = request.principal?.userId ?? null;

    const rows = await db
      .select({
        post: posts,
        author: { id: users.id, firstName: users.firstName, lastName: users.lastName, avatarKey: users.avatarKey },
        group: { slug: groups.slug, name: groups.name },
      })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId))
      .leftJoin(groups, eq(groups.slug, posts.groupSlug))
      .where(query.group ? eq(posts.groupSlug, query.group) : sql`true`)
      .orderBy(desc(posts.createdAt))
      .limit(query.limit)
      .offset(query.offset);

    const ids = rows.map((row) => row.post.id);
    const liked = viewerId && ids.length > 0
      ? await db
          .select({ postId: postLikes.postId })
          .from(postLikes)
          .where(and(eq(postLikes.userId, viewerId), sql`${postLikes.postId} in ${ids}`))
      : [];
    const saved = viewerId && ids.length > 0
      ? await db
          .select({ postId: postSaves.postId })
          .from(postSaves)
          .where(and(eq(postSaves.userId, viewerId), sql`${postSaves.postId} in ${ids}`))
      : [];

    const likedSet = new Set(liked.map((row) => row.postId));
    const savedSet = new Set(saved.map((row) => row.postId));

    return {
      posts: rows.map((row) => ({
        ...row.post,
        author: row.author,
        group: row.group,
        likedByViewer: likedSet.has(row.post.id),
        savedByViewer: savedSet.has(row.post.id),
      })),
    };
  });

  app.get('/community/posts/:id', async (request) => {
    const { id } = parse(z.object({ id: z.string().max(40) }), request.params);
    const { db } = request.ctx;

    const [post] = await db
      .select({
        post: posts,
        author: { id: users.id, firstName: users.firstName, lastName: users.lastName, avatarKey: users.avatarKey },
      })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId))
      .where(eq(posts.id, id))
      .limit(1);
    if (!post) throw notFound('Post');

    const comments = await db
      .select({
        comment: postComments,
        author: { firstName: users.firstName, lastName: users.lastName, avatarKey: users.avatarKey },
      })
      .from(postComments)
      .innerJoin(users, eq(users.id, postComments.authorId))
      .where(eq(postComments.postId, id))
      .orderBy(postComments.createdAt);

    return { post: post.post, author: post.author, comments };
  });

  app.post('/community/posts', async (request) => {
    const principal = requireMember(request.principal);
    const body = parse(
      z.object({
        groupSlug: z.string().max(48).optional(),
        kind: z.enum(['update', 'workout', 'personal-record', 'question', 'transformation']).default('update'),
        body: z.string().trim().min(1).max(2000),
        mediaKey: z.string().max(120).optional(),
        workoutLogId: z.string().max(40).optional(),
      }),
      request.body,
    );
    const { db } = request.ctx;

    if (body.groupSlug) {
      const [group] = await db.select({ slug: groups.slug }).from(groups)
        .where(eq(groups.slug, body.groupSlug)).limit(1);
      if (!group) throw notFound('Group');
    }

    const id = randomId('post');
    await db.insert(posts).values({
      id, authorId: principal.userId, groupSlug: body.groupSlug ?? null, kind: body.kind,
      body: body.body, mediaKey: body.mediaKey ?? null, workoutLogId: body.workoutLogId ?? null,
    });
    return { ok: true, id };
  });

  app.post('/community/posts/:id/like', async (request) => {
    const principal = requireMember(request.principal);
    const { id } = parse(z.object({ id: z.string().max(40) }), request.params);
    const { db } = request.ctx;

    const [post] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) throw notFound('Post');

    const existing = await db
      .select({ id: postLikes.id }).from(postLikes)
      .where(and(eq(postLikes.postId, id), eq(postLikes.userId, principal.userId)))
      .limit(1);

    if (existing[0]) {
      await db.delete(postLikes).where(eq(postLikes.id, existing[0].id));
      // The counter is derived from the join table rather than incremented, so
      // a double tap can never leave it drifting from reality.
      await syncLikeCount(db, id);
      return { ok: true, liked: false };
    }

    await db.insert(postLikes).values({ id: randomId('post'), postId: id, userId: principal.userId });
    await syncLikeCount(db, id);
    return { ok: true, liked: true };
  });

  app.post('/community/posts/:id/save', async (request) => {
    const principal = requireMember(request.principal);
    const { id } = parse(z.object({ id: z.string().max(40) }), request.params);
    const { db } = request.ctx;

    const existing = await db
      .select({ id: postSaves.id }).from(postSaves)
      .where(and(eq(postSaves.postId, id), eq(postSaves.userId, principal.userId)))
      .limit(1);

    if (existing[0]) {
      await db.delete(postSaves).where(eq(postSaves.id, existing[0].id));
      return { ok: true, saved: false };
    }
    await db.insert(postSaves).values({ id: randomId('post'), postId: id, userId: principal.userId });
    return { ok: true, saved: true };
  });

  app.post('/community/posts/:id/comments', async (request) => {
    const principal = requireMember(request.principal);
    const { id } = parse(z.object({ id: z.string().max(40) }), request.params);
    const body = parse(z.object({ body: z.string().trim().min(1).max(1000) }), request.body);
    const { db } = request.ctx;

    const [post] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) throw notFound('Post');

    const commentId = randomId('comment');
    await db.insert(postComments).values({
      id: commentId, postId: id, authorId: principal.userId, body: body.body,
    });
    await db.update(posts)
      .set({ commentCount: sql`(select count(*)::int from post_comments where post_id = ${id})` })
      .where(eq(posts.id, id));

    return { ok: true, id: commentId };
  });

  app.post('/community/follow/:userId', async (request) => {
    const principal = requireMember(request.principal);
    const { userId } = parse(z.object({ userId: z.string().max(40) }), request.params);
    const { db } = request.ctx;

    if (userId === principal.userId) {
      throw conflict('self_follow', 'You cannot follow yourself.');
    }
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!target) throw notFound('Member');

    const existing = await db
      .select({ id: follows.id }).from(follows)
      .where(and(eq(follows.followerId, principal.userId), eq(follows.followeeId, userId)))
      .limit(1);

    if (existing[0]) {
      await db.delete(follows).where(eq(follows.id, existing[0].id));
      return { ok: true, following: false };
    }
    await db.insert(follows).values({
      id: randomId('user'), followerId: principal.userId, followeeId: userId,
    });
    return { ok: true, following: true };
  });

  app.get('/me/challenges', async (request) => {
    const principal = requireMember(request.principal);
    const { db, today } = request.ctx;

    const mine = await db
      .select().from(challengeParticipants)
      .where(eq(challengeParticipants.userId, principal.userId));

    const following = await db
      .select({ followeeId: follows.followeeId })
      .from(follows)
      .where(eq(follows.followerId, principal.userId));
    const friendIds = new Set(following.map((row) => row.followeeId));

    const boards = await Promise.all(
      CHALLENGES.map(async (challenge) => {
        const entries = await db
          .select({
            userId: challengeParticipants.userId, value: challengeParticipants.value,
            visible: challengeParticipants.visible,
            firstName: users.firstName, lastName: users.lastName,
          })
          .from(challengeParticipants)
          .innerJoin(users, eq(users.id, challengeParticipants.userId))
          .where(eq(challengeParticipants.challengeSlug, challenge.slug));

        const leaderboard = buildLeaderboard(
          challenge,
          entries.map((entry) => ({
            userId: entry.userId,
            displayName: `${entry.firstName} ${entry.lastName.charAt(0)}.`,
            value: entry.value,
            visible: entry.visible,
            isFriend: friendIds.has(entry.userId),
          })),
        );

        const participation = mine.find((row) => row.challengeSlug === challenge.slug);
        return {
          challenge,
          participants: entries.length,
          joined: participation !== undefined,
          progress: participation
            ? challengeProgress(
                challenge,
                participation.value,
                Math.max(0, daysBetween(participation.startedOn, today())),
              )
            : null,
          leaderboard: leaderboard.slice(0, 10),
          myRank: leaderboard.find((row) => row.userId === principal.userId)?.rank ?? null,
        };
      }),
    );

    return { challenges: boards };
  });

  app.post('/me/challenges/:slug/join', async (request) => {
    const principal = requireMember(request.principal);
    const { slug } = parse(z.object({ slug: z.string().max(64) }), request.params);
    const body = parse(z.object({ visible: z.boolean().default(true) }), request.body ?? {});
    const { db, today } = request.ctx;

    const challenge = findChallenge(slug);
    if (!challenge) throw notFound('Challenge');

    const existing = await db
      .select({ id: challengeParticipants.id }).from(challengeParticipants)
      .where(and(
        eq(challengeParticipants.challengeSlug, slug),
        eq(challengeParticipants.userId, principal.userId),
      ))
      .limit(1);

    if (existing[0]) {
      await db.delete(challengeParticipants).where(eq(challengeParticipants.id, existing[0].id));
      return { ok: true, joined: false };
    }

    await db.insert(challengeParticipants).values({
      id: randomId('challenge'), challengeSlug: slug, userId: principal.userId,
      value: 0, startedOn: today(), visible: body.visible,
    });
    return { ok: true, joined: true };
  });

  app.patch('/me/challenges/:slug', async (request) => {
    const principal = requireMember(request.principal);
    const { slug } = parse(z.object({ slug: z.string().max(64) }), request.params);
    const body = parse(
      z.object({
        value: z.number().int().min(0).max(10_000_000).optional(),
        visible: z.boolean().optional(),
      }),
      request.body,
    );
    const { db } = request.ctx;

    const result = await db
      .update(challengeParticipants)
      .set({ ...body, updatedAt: new Date() })
      .where(and(
        eq(challengeParticipants.challengeSlug, slug),
        eq(challengeParticipants.userId, principal.userId),
      ))
      .returning();

    if (result.length === 0) throw notFound('Challenge entry');
    return { ok: true };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncLikeCount(db: any, postId: string): Promise<void> {
  await db.update(posts)
    .set({ likeCount: sql`(select count(*)::int from post_likes where post_id = ${postId})` })
    .where(eq(posts.id, postId));
}
