import { z } from 'zod';
import {
  AGE_RANGES, COACHING_PREFERENCES, DIET_PREFERENCES, EQUIPMENT,
  EXPERIENCE_LEVELS, GOALS, TRAINING_LOCATIONS,
} from '@forge/core';

/**
 * Request schemas built from the domain's own unions, so adding a goal to
 * `@forge/core` cannot leave the API rejecting it.
 */
export const answersSchema = z.object({
  primaryGoal: z.enum(GOALS),
  secondaryGoals: z.array(z.enum(GOALS)).max(6).default([]),
  ageRange: z.enum(AGE_RANGES),
  experience: z.enum(EXPERIENCE_LEVELS),
  daysPerWeek: z.number().int().min(1).max(7),
  sessionMinutes: z.number().int().min(10).max(180),
  location: z.enum(TRAINING_LOCATIONS),
  equipment: z.array(z.enum(EQUIPMENT)).min(1).max(EQUIPMENT.length),
  diet: z.enum(DIET_PREFERENCES),
  coaching: z.enum(COACHING_PREFERENCES),
  heightCm: z.number().int().min(120).max(230).optional(),
  weightKg: z.number().int().min(35).max(250).optional(),
  sexAtBirth: z.enum(['female', 'male', 'prefer-not-to-say']).optional(),
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
