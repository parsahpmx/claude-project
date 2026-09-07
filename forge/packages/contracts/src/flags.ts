/**
 * Feature flags for the web beta.
 *
 * The brief's §95/§96 classification, expressed as code so that a screen cannot
 * quietly ship ahead of the operations behind it. A flag that is off should
 * mean the route is absent, not that a page renders an empty promise.
 */

export type FlagState = 'core' | 'optional' | 'post-beta';

export const FEATURES = {
  // --- BETA CORE: the beta is not a beta without these.
  auth: 'core',
  activities: 'core',
  maps: 'core',
  routes: 'core',
  training: 'core',
  progress: 'core',
  goals: 'core',
  privacy: 'core',

  // --- BETA OPTIONAL: shipped behind a flag, safe to disable per environment.
  feed: 'optional',
  follows: 'optional',
  clubs: 'optional',
  challenges: 'optional',
  events: 'optional',

  // --- POST-BETA: schema may exist, product surface deliberately does not.
  messaging: 'post-beta',
  coaching: 'post-beta',
  nutrition: 'post-beta',
  recovery: 'post-beta',
  globalHeatmap: 'post-beta',
  segments: 'post-beta',
  liveSegments: 'post-beta',
  raceMarketplace: 'post-beta',
  advancedAi: 'post-beta',

  // --- Platform phases. Named now so that the surfaces cannot be switched on
  // by an environment variable before the security work behind them is done.
  // Each one moves to 'optional' in the phase that builds and verifies it.
  coachPlatform: 'post-beta',
  gymPlatform: 'post-beta',
  classBooking: 'post-beta',
  qrAccess: 'post-beta',
  payments: 'post-beta',
  aiAssistant: 'post-beta',
  googleMaps: 'post-beta',
  adminConsole: 'post-beta',
} as const satisfies Record<string, FlagState>;

export type FeatureName = keyof typeof FEATURES;

/**
 * Post-beta features are off no matter what the environment says — a flag file
 * should not be able to expose a surface that was never built. Optional ones
 * default on and can be disabled with FORGE_DISABLED_FEATURES.
 */
export function isEnabled(name: FeatureName, disabled: readonly string[] = []): boolean {
  const state = FEATURES[name];
  // A name TypeScript never saw — from config, a URL, an older deployment —
  // has no state, and an undefined state must not fall through to "enabled".
  if (!state) return false;
  if (state === 'post-beta') return false;
  if (state === 'core') return true;
  return !disabled.includes(name);
}

/** True when `name` is a flag this build knows about. */
export function isKnownFeature(name: string): name is FeatureName {
  return Object.hasOwn(FEATURES, name);
}

export function parseDisabledFeatures(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
