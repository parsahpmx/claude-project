/**
 * Prefixed identifiers.
 *
 * An id carries its own type: `wk_` in a coach-note field is visibly wrong in a
 * log line, and support can tell a workout from a week without a schema lookup.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export const ID_PREFIXES = {
  user: 'usr',
  session: 'ses',
  profile: 'prf',
  plan: 'pln',
  planWeek: 'pwk',
  planDay: 'pdy',
  program: 'prg',
  workout: 'wkt',
  exercise: 'exr',
  workoutLog: 'wlg',
  setLog: 'slg',
  meal: 'mel',
  recipe: 'rcp',
  mealLog: 'mlg',
  coach: 'coa',
  booking: 'bkg',
  message: 'msg',
  thread: 'thr',
  checkIn: 'cin',
  post: 'pst',
  comment: 'cmt',
  challenge: 'chl',
  product: 'prd',
  order: 'ord',
  subscription: 'sub',
  invoice: 'inv',
  device: 'dev',
  article: 'art',
  story: 'sty',
  notification: 'ntf',
  event: 'evt',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

/**
 * Deterministic id generator. Seeded so the demo dataset is byte-identical on
 * every seed run — screenshots, tests and docs all reference the same ids.
 */
export function createIdFactory(seed = 1): (kind: IdKind) => string {
  let state = seed >>> 0 || 1;
  return (kind: IdKind) => {
    let out = '';
    for (let i = 0; i < 14; i += 1) {
      // xorshift32: small, dependency-free, and stable across Node versions.
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      out += ALPHABET[state % ALPHABET.length];
    }
    return `${ID_PREFIXES[kind]}_${out}`;
  };
}

export function randomId(kind: IdKind): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${ID_PREFIXES[kind]}_${out}`;
}

/** Stable slug for URLs: "Muscle Builder" → "muscle-builder". */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
