import { z } from 'zod';
import { SPORTS, VISIBILITY } from './types.js';

/**
 * Every mutation the browser can reach is validated here first, so a route
 * handler never trusts a shape it was handed. The database's constraints are
 * the backstop, not the front line.
 */

export const sportSchema = z.enum(SPORTS);
export const visibilitySchema = z.enum(VISIBILITY);

export const lngLatSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

export const profileUpdateSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-z0-9_]+$/i, 'Letters, numbers and underscores only').optional(),
  displayName: z.string().min(1).max(60).optional(),
  bio: z.string().max(400).optional(),
  primarySport: sportSchema.nullable().optional(),
  locationName: z.string().max(120).nullable().optional(),
  units: z.enum(['metric', 'imperial']).optional(),
});

export const privacyUpdateSchema = z.object({
  profileVisibility: visibilitySchema.optional(),
  defaultActivityVisibility: visibilitySchema.optional(),
  routeVisibility: visibilitySchema.optional(),
  requireFollowApproval: z.boolean().optional(),
  hideStartEnd: z.boolean().optional(),
  hideRadiusM: z.number().int().min(0).max(2000).optional(),
  coachSharing: z.boolean().optional(),
  aggregateContribution: z.boolean().optional(),
  analyticsConsent: z.boolean().optional(),
  aiConsent: z.boolean().optional(),
});

export const activityCreateSchema = z.object({
  sport: sportSchema,
  title: z.string().min(1).max(140),
  description: z.string().max(2000).default(''),
  startedAt: z.string().datetime(),
  timezone: z.string().max(64).default('UTC'),
  elapsedS: z.number().int().min(0).max(86_400 * 7),
  movingS: z.number().int().min(0).max(86_400 * 7),
  distanceM: z.number().int().min(0).max(1_000_000),
  elevationGainM: z.number().int().min(0).max(30_000),
  avgHr: z.number().int().min(20).max(260).nullable().default(null),
  maxHr: z.number().int().min(20).max(260).nullable().default(null),
  calories: z.number().int().min(0).max(30_000).nullable().default(null),
  visibility: visibilitySchema.optional(),
  // Bounded so one request cannot post a million-point track (§77).
  track: z.array(lngLatSchema).max(50_000).optional(),
}).refine((v) => v.movingS <= v.elapsedS, {
  message: 'Moving time cannot exceed elapsed time',
  path: ['movingS'],
});

export const routeCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(''),
  sport: sportSchema.default('run'),
  surface: z.enum(['road', 'trail', 'mixed', 'track', 'unknown']).default('unknown'),
  visibility: visibilitySchema.optional(),
  path: z.array(lngLatSchema).min(2).max(20_000),
});

export const goalCreateSchema = z.object({
  kind: z.enum(['weekly_sessions', 'weekly_minutes', 'weekly_distance', 'strength_sessions', 'program_completion', 'race']),
  sport: sportSchema.nullable().default(null),
  target: z.number().positive().max(1_000_000),
  unit: z.string().max(16).default(''),
  periodStart: z.string().date(),
  periodEnd: z.string().date().nullable().default(null),
});

export const onboardingSchema = z.object({
  experience: z.enum(['beginner', 'intermediate', 'advanced']),
  goals: z.array(z.string().max(40)).min(1).max(8),
  sports: z.array(sportSchema).min(1),
  weeklySessions: z.number().int().min(1).max(14),
  equipment: z.array(z.string().max(40)).max(20).default([]),
  profileVisibility: visibilitySchema.default('followers'),
  displayName: z.string().min(1).max(60),
});

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
export type PrivacyUpdate = z.infer<typeof privacyUpdateSchema>;
export type ActivityCreate = z.infer<typeof activityCreateSchema>;
export type RouteCreate = z.infer<typeof routeCreateSchema>;
export type GoalCreate = z.infer<typeof goalCreateSchema>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;
