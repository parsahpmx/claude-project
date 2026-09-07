/**
 * FORGE Web — domain types shared by the web app, future iOS bridge and tests.
 *
 * These are hand-curated rather than generated, and the integration tests in
 * `apps/beta/src/lib/__tests__` run the real queries against the real database
 * so drift shows up as a failing test rather than as a type that quietly lies.
 */

export const SPORTS = [
  'run',
  'walk',
  'hike',
  'ride',
  'strength',
  'functional',
  'mobility',
] as const;
export type Sport = (typeof SPORTS)[number];

/** Sports whose sessions are distance-and-pace shaped rather than set-and-rep shaped. */
export const DISTANCE_SPORTS: readonly Sport[] = ['run', 'walk', 'hike', 'ride'];
export const STRENGTH_SPORTS: readonly Sport[] = ['strength', 'functional'];

export const VISIBILITY = ['private', 'followers', 'public'] as const;
export type Visibility = (typeof VISIBILITY)[number];

export type FollowStatus = 'pending' | 'accepted';
export type PlanStatus = 'active' | 'completed' | 'abandoned';
export type DayStatus = 'scheduled' | 'completed' | 'skipped' | 'rest';
export type Surface = 'road' | 'trail' | 'mixed' | 'track' | 'unknown';
export type ActivitySource = 'manual' | 'upload' | 'ios' | 'web';

export type GoalKind =
  | 'weekly_sessions'
  | 'weekly_minutes'
  | 'weekly_distance'
  | 'strength_sessions'
  | 'program_completion'
  | 'race';

export interface Profile {
  id: string;
  username: string | null;
  displayName: string;
  bio: string;
  avatarPath: string | null;
  primarySport: Sport | null;
  locationName: string | null;
  units: 'metric' | 'imperial';
  onboardedAt: string | null;
}

export interface PrivacySettings {
  userId: string;
  profileVisibility: Visibility;
  defaultActivityVisibility: Visibility;
  routeVisibility: Visibility;
  requireFollowApproval: boolean;
  hideStartEnd: boolean;
  hideRadiusM: number;
  coachSharing: boolean;
  aggregateContribution: boolean;
  analyticsConsent: boolean;
  aiConsent: boolean;
}

export interface Activity {
  id: string;
  userId: string;
  sport: Sport;
  title: string;
  description: string;
  startedAt: string;
  timezone: string;
  elapsedS: number;
  movingS: number;
  distanceM: number;
  elevationGainM: number;
  avgHr: number | null;
  maxHr: number | null;
  calories: number | null;
  trainingLoad: number | null;
  visibility: Visibility;
  source: ActivitySource;
  hasGps: boolean;
  /** Sanitized. The raw track is owner-only and lives in a separate table. */
  mapPolyline: string | null;
  processedAt: string | null;
}

export interface ActivitySplit {
  idx: number;
  distanceM: number;
  elapsedS: number;
  elevationM: number | null;
  avgHr: number | null;
}

export interface StrengthSet {
  id: string;
  exerciseSlug: string;
  setIndex: number;
  reps: number;
  loadG: number;
  rpe: number | null;
  completed: boolean;
}

export interface Route {
  id: string;
  userId: string;
  name: string;
  description: string;
  sport: Sport;
  distanceM: number;
  elevationGainM: number;
  estimatedS: number;
  surface: Surface;
  visibility: Visibility;
}

export interface Goal {
  id: string;
  kind: GoalKind;
  sport: Sport | null;
  target: number;
  unit: string;
  periodStart: string;
  periodEnd: string | null;
  status: 'active' | 'achieved' | 'missed' | 'archived';
}

export interface PlanDay {
  id: string;
  planId: string;
  date: string;
  weekIndex: number;
  phase: string;
  title: string;
  sport: Sport | null;
  kind: string;
  status: DayStatus;
  activityId: string | null;
}

/** A point as [longitude, latitude], the order GeoJSON and MapLibre both use. */
export type LngLat = [number, number];
