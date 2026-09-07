import { cache } from 'react';
import type { Activity, Goal, PlanDay, Sport, Visibility } from '@forge/contracts';
import { createClient } from './supabase/server';

/**
 * Every read the authenticated app performs.
 *
 * Two rules hold throughout, per §77:
 *  - columns are named explicitly, never `select('*')`, so a query cannot start
 *    shipping a new column (or a GPS track) the day someone adds one;
 *  - every list is bounded, and the feed pages by cursor rather than by offset.
 */

const ACTIVITY_COLUMNS =
  'id, user_id, sport, title, description, started_at, timezone, elapsed_s, moving_s, ' +
  'distance_m, elevation_gain_m, avg_hr, max_hr, calories, training_load, visibility, ' +
  'source, has_gps, map_polyline, processed_at';

/**
 * PostgREST returns an embedded relation as an array unless it can prove the
 * relationship is to-one, which it cannot without generated types. Reading
 * `row.profiles.display_name` off that array would silently yield undefined,
 * so the shape is modelled honestly and narrowed in one helper.
 */
type Embedded<T> = T | T[] | null;

function firstOf<T>(value: Embedded<T>): T | null {
  if (value === null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

type AthleteRef = { display_name: string; username: string | null };

type ActivityRow = {
  id: string;
  user_id: string;
  sport: Sport;
  title: string;
  description: string;
  started_at: string;
  timezone: string;
  elapsed_s: number;
  moving_s: number;
  distance_m: number;
  elevation_gain_m: number;
  avg_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  training_load: number | null;
  visibility: Visibility;
  source: Activity['source'];
  has_gps: boolean;
  map_polyline: string | null;
  processed_at: string | null;
};

function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    userId: row.user_id,
    sport: row.sport,
    title: row.title,
    description: row.description,
    startedAt: row.started_at,
    timezone: row.timezone,
    elapsedS: row.elapsed_s,
    movingS: row.moving_s,
    distanceM: row.distance_m,
    elevationGainM: row.elevation_gain_m,
    avgHr: row.avg_hr,
    maxHr: row.max_hr,
    calories: row.calories,
    trainingLoad: row.training_load,
    visibility: row.visibility,
    source: row.source,
    hasGps: row.has_gps,
    mapPolyline: row.map_polyline,
    processedAt: row.processed_at,
  };
}

/** Deduplicated per request, so a layout and its page do not both fetch it. */
export const getSessionProfile = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('profiles')
    .select(
      'id, username, display_name, bio, avatar_path, primary_sport, location_name, units, onboarded_at',
    )
    .eq('id', user.id)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    username: data.username,
    displayName: data.display_name,
    bio: data.bio,
    avatarPath: data.avatar_path,
    primarySport: data.primary_sport,
    locationName: data.location_name,
    units: data.units,
    onboardedAt: data.onboarded_at,
  };
});

export async function getMyActivities(limit = 20, before?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  let query = supabase
    .from('activities')
    .select(ACTIVITY_COLUMNS)
    .eq('user_id', user.id)
    .order('started_at', { ascending: false })
    .limit(Math.min(limit, 50));

  // Cursor, not offset: a deep page stays as cheap as the first one.
  if (before) query = query.lt('started_at', before);

  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as ActivityRow[]).map(toActivity);
}

/**
 * The feed. RLS decides what is visible, so this does not re-implement the
 * follow rules — it asks for recent activities and the database returns the
 * ones this viewer is allowed to see.
 */
export async function getFeed(limit = 20, before?: string) {
  const supabase = await createClient();
  let query = supabase
    .from('activities')
    .select(`${ACTIVITY_COLUMNS}, profiles!inner(display_name, username)`)
    .neq('visibility', 'private')
    .order('started_at', { ascending: false })
    .limit(Math.min(limit, 50));

  if (before) query = query.lt('started_at', before);

  const { data, error } = await query;
  if (error) throw error;

  return (data as unknown as (ActivityRow & { profiles: Embedded<AthleteRef> })[]).map((row) => {
    const athlete = firstOf(row.profiles);
    return {
      ...toActivity(row),
      athlete: {
        displayName: athlete?.display_name ?? 'Athlete',
        username: athlete?.username ?? null,
      },
    };
  });
}

export async function getActivity(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('activities')
    .select(`${ACTIVITY_COLUMNS}, profiles!inner(display_name, username)`)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as ActivityRow & { profiles: Embedded<AthleteRef> };
  const athlete = firstOf(row.profiles);
  return {
    ...toActivity(row),
    athlete: {
      displayName: athlete?.display_name ?? 'Athlete',
      username: athlete?.username ?? null,
    },
  };
}

/** Splits load with the detail page, never with the feed (§26). */
export async function getActivitySplits(activityId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('activity_splits')
    .select('idx, distance_m, elapsed_s, elevation_m, avg_hr')
    .eq('activity_id', activityId)
    .order('idx');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    idx: r.idx,
    distanceM: r.distance_m,
    elapsedS: r.elapsed_s,
    elevationM: r.elevation_m,
    avgHr: r.avg_hr,
  }));
}

export async function getStrengthSets(activityId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('strength_sets')
    .select('id, exercise_slug, set_index, reps, load_g, rpe, completed')
    .eq('activity_id', activityId)
    .order('exercise_slug')
    .order('set_index');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    exerciseSlug: r.exercise_slug,
    setIndex: r.set_index,
    reps: r.reps,
    loadG: r.load_g,
    rpe: r.rpe,
    completed: r.completed,
  }));
}

export async function getActiveGoals(): Promise<Goal[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('goals')
    .select('id, kind, sport, target, unit, period_start, period_end, status')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('period_start', { ascending: false })
    .limit(10);
  if (error) throw error;

  return (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    sport: r.sport,
    target: Number(r.target),
    unit: r.unit,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    status: r.status,
  }));
}

export async function getUpcomingPlanDays(from: string, to: string): Promise<PlanDay[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('plan_days')
    .select('id, plan_id, date, week_index, phase, title, sport, kind, status, activity_id')
    .eq('user_id', user.id)
    .gte('date', from)
    .lte('date', to)
    .order('date')
    .limit(60);
  if (error) throw error;

  return (data ?? []).map((r) => ({
    id: r.id,
    planId: r.plan_id,
    date: r.date,
    weekIndex: r.week_index,
    phase: r.phase,
    title: r.title,
    sport: r.sport,
    kind: r.kind,
    status: r.status,
    activityId: r.activity_id,
  }));
}

export async function getMyRoutes(limit = 24) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('routes')
    .select(
      'id, user_id, name, description, sport, distance_m, elevation_gain_m, estimated_s, surface, visibility',
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 50));
  if (error) throw error;

  return (data ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    description: r.description,
    sport: r.sport,
    distanceM: r.distance_m,
    elevationGainM: r.elevation_gain_m,
    estimatedS: r.estimated_s,
    surface: r.surface,
    visibility: r.visibility,
  }));
}

export async function getPrivacySettings() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('privacy_settings')
    .select(
      'user_id, profile_visibility, default_activity_visibility, route_visibility, require_follow_approval, hide_start_end, hide_radius_m, coach_sharing, aggregate_contribution, analytics_consent, ai_consent',
    )
    .eq('user_id', user.id)
    .maybeSingle();

  if (!data) return null;
  return {
    userId: data.user_id,
    profileVisibility: data.profile_visibility,
    defaultActivityVisibility: data.default_activity_visibility,
    routeVisibility: data.route_visibility,
    requireFollowApproval: data.require_follow_approval,
    hideStartEnd: data.hide_start_end,
    hideRadiusM: data.hide_radius_m,
    coachSharing: data.coach_sharing,
    aggregateContribution: data.aggregate_contribution,
    analyticsConsent: data.analytics_consent,
    aiConsent: data.ai_consent,
  };
}

export async function getPrivateZones() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('private_zones')
    .select('id, label, radius_m')
    .eq('user_id', user.id)
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, label: r.label, radiusM: r.radius_m }));
}
