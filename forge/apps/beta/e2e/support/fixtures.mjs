// Fixture rows are supersets of every column the app selects; the mock applies
// the `select` projection, so these stay in one place per table.
export const USER_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_ID = '22222222-2222-4222-8222-222222222222';

const iso = (daysAgo, h = 7) => new Date(Date.UTC(2026, 8, 6 - daysAgo, h, 30, 0)).toISOString();
const day = (offset) => {
  const d = new Date(Date.UTC(2026, 8, 6 + offset));
  return d.toISOString().slice(0, 10);
};

// A short encoded polyline (precision 5) near Manchester, so map views have
// something real to draw rather than an empty canvas.
const POLY = 'ynd~HzallAqAgFsAaEmAsD_AoCu@_BeAcB{@kAaAeAeAaAkA{@';

export const profiles = [
  {
    id: USER_ID,
    username: 'beta_athlete',
    display_name: 'Beta Athlete',
    bio: 'Verification account for the beta harness.',
    avatar_path: null,
    primary_sport: 'run',
    location_name: 'Manchester, UK',
    units: 'metric',
    onboarded_at: iso(30),
  },
  {
    id: OTHER_ID,
    username: 'sam_r',
    display_name: 'Sam Rivera',
    bio: 'Follows you.',
    avatar_path: null,
    primary_sport: 'ride',
    location_name: 'Leeds, UK',
    units: 'metric',
    onboarded_at: iso(60),
  },
];

const mkActivity = (i, over = {}) => ({
  id: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`,
  user_id: USER_ID,
  sport: ['run', 'ride', 'walk', 'strength', 'hike'][i % 5],
  title: ['Morning run', 'Commute ride', 'Recovery walk', 'Lower body', 'Edale ridge'][i % 5],
  description: i % 3 === 0 ? 'Felt strong throughout. Negative split.' : '',
  started_at: iso(i),
  timezone: 'Europe/London',
  elapsed_s: 1800 + i * 420,
  moving_s: 1740 + i * 400,
  distance_m: [8200, 24500, 3100, 0, 15400][i % 5],
  elevation_gain_m: [64, 210, 12, 0, 720][i % 5],
  avg_hr: 138 + (i % 7),
  max_hr: 168 + (i % 5),
  calories: 420 + i * 30,
  training_load: 60 + i * 4,
  visibility: ['followers', 'private', 'public'][i % 3],
  source: 'manual',
  has_gps: i % 5 !== 3,
  map_polyline: i % 5 === 3 ? null : POLY,
  processed_at: iso(i, 8),
  ...over,
});

export const activities = [
  ...Array.from({ length: 9 }, (_, i) => mkActivity(i)),
  mkActivity(20, {
    user_id: OTHER_ID,
    title: 'Club chaingang',
    sport: 'ride',
    visibility: 'public',
  }),
];

export const activity_splits = Array.from({ length: 8 }, (_, i) => ({
  activity_id: activities[0].id,
  idx: i + 1,
  distance_m: 1000,
  elapsed_s: 268 + (i % 3) * 7,
  elevation_m: 6 + (i % 4) * 3,
  avg_hr: 142 + (i % 5),
}));

export const strength_sets = ['back-squat', 'romanian-deadlift'].flatMap((slug, s) =>
  Array.from({ length: 4 }, (_, i) => ({
    id: `bbbbbbbb-0000-4000-8000-${String(s * 10 + i).padStart(12, '0')}`,
    activity_id: activities[3].id,
    exercise_slug: slug,
    set_index: i + 1,
    reps: 8 - i,
    load_g: (60 + i * 5) * 1000,
    rpe: 7 + i * 0.5,
    completed: true,
  })),
);

export const goals = [
  {
    id: 'ccccccc1-0000-4000-8000-000000000001',
    user_id: USER_ID,
    kind: 'weekly_distance',
    sport: 'run',
    target: 40000,
    unit: 'm',
    period_start: day(-6),
    period_end: day(1),
    status: 'active',
  },
  {
    id: 'ccccccc1-0000-4000-8000-000000000002',
    user_id: USER_ID,
    kind: 'weekly_sessions',
    sport: null,
    target: 4,
    unit: '',
    period_start: day(-6),
    period_end: day(1),
    status: 'active',
  },
];

export const plans = [
  {
    id: 'ddddddd1-0000-4000-8000-000000000001',
    user_id: USER_ID,
    name: '10K build',
    program_slug: 'ten-k-build',
    start_date: day(-14),
    weeks: 8,
    status: 'active',
  },
];

export const plan_days = Array.from({ length: 10 }, (_, i) => ({
  id: `eeeeeee1-0000-4000-8000-${String(i).padStart(12, '0')}`,
  user_id: USER_ID,
  plan_id: plans[0].id,
  date: day(i - 2),
  week_index: 3,
  phase: 'build',
  title: ['Easy 6K', 'Intervals 6x800', 'Rest', 'Tempo 5K', 'Strength'][i % 5],
  sport: ['run', 'run', 'rest', 'run', 'strength'][i % 5],
  kind: ['easy', 'intervals', 'rest', 'tempo', 'strength'][i % 5],
  status: i < 2 ? 'done' : 'planned',
  activity_id: i < 2 ? activities[i].id : null,
}));

export const programs = [
  {
    slug: 'ten-k-build',
    name: '10K Build',
    tagline: 'Eight weeks to a stronger 10K.',
    sport: 'run',
    weeks: 8,
    sessions_per_week: 4,
    difficulty: 'intermediate',
    description: 'Progressive build with tempo and interval work.',
  },
  {
    slug: 'base-strength',
    name: 'Base Strength',
    tagline: 'Barbell fundamentals, three days a week.',
    sport: 'strength',
    weeks: 12,
    sessions_per_week: 3,
    difficulty: 'beginner',
    description: 'Squat, hinge, push, pull.',
  },
];

export const routes = Array.from({ length: 5 }, (_, i) => ({
  id: `fffffff1-0000-4000-8000-${String(i).padStart(12, '0')}`,
  user_id: USER_ID,
  name: ['Canal loop', 'Heaton park circuit', 'Ridge out-and-back', 'River path', 'Hill repeats'][
    i
  ],
  description: 'Saved from a recent activity.',
  sport: i % 2 ? 'ride' : 'run',
  distance_m: 5200 + i * 3100,
  elevation_gain_m: 30 + i * 55,
  estimated_s: 1500 + i * 700,
  surface: ['path', 'road', 'trail', 'path', 'road'][i],
  visibility: ['private', 'followers', 'public'][i % 3],
  created_at: iso(i + 2),
  polyline: POLY,
}));

export const privacy_settings = [
  {
    user_id: USER_ID,
    profile_visibility: 'followers',
    default_activity_visibility: 'followers',
    route_visibility: 'private',
    require_follow_approval: true,
    hide_start_end: true,
    hide_radius_m: 250,
    coach_sharing: false,
    aggregate_contribution: false,
    analytics_consent: false,
    ai_consent: false,
  },
];

export const private_zones = [
  {
    id: 'aaaabbbb-0000-4000-8000-000000000001',
    user_id: USER_ID,
    label: 'Home',
    radius_m: 300,
    created_at: iso(40),
  },
  {
    id: 'aaaabbbb-0000-4000-8000-000000000002',
    user_id: USER_ID,
    label: 'Work',
    radius_m: 200,
    created_at: iso(39),
  },
];

export const exercise_prs = [
  {
    user_id: USER_ID,
    exercise_slug: 'back-squat',
    best_1rm_g: 142000,
    best_volume_g: 4800000,
    best_reps: 8,
    achieved_at: iso(9),
  },
  {
    user_id: USER_ID,
    exercise_slug: 'bench-press',
    best_1rm_g: 95000,
    best_volume_g: 3100000,
    best_reps: 6,
    achieved_at: iso(16),
  },
];

export const clubs = [
  {
    id: 'ddddeeee-0000-4000-8000-000000000001',
    slug: 'north-runners',
    name: 'North Runners',
    description: 'Weekly club runs.',
    sport: 'run',
    location_name: 'Manchester, UK',
  },
];

export const challenges = [
  {
    id: 'ddddeeee-0000-4000-8000-000000000009',
    slug: 'sept-100k',
    name: 'September 100K',
    description: 'Cover 100K this month, any pace.',
    metric: 'distance',
    sport: 'run',
    target: 100000,
    starts_on: day(-6),
    ends_on: day(24),
  },
];

export const TABLES = {
  profiles,
  activities,
  activity_splits,
  strength_sets,
  goals,
  plans,
  plan_days,
  programs,
  routes,
  privacy_settings,
  private_zones,
  exercise_prs,
  clubs,
  challenges,
};
