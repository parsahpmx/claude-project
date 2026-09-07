/**
 * Environment access, in one place.
 *
 * Only the URL and the publishable key are ever read here. The service role key
 * is not read, not typed and not referenced anywhere in this app: a key that has
 * no code path cannot be leaked by one.
 */

/**
 * What to tell someone whose `.env.local` is missing.
 *
 * `.env.local` is gitignored, because it holds a project's own keys — so a
 * fresh clone has none, and every route in the app used to answer 500 with
 * "NEXT_PUBLIC_SUPABASE_URL is not set". That is true, and useless: it names a
 * variable rather than the file to create, and it appears even on the marketing
 * pages, which need no database at all.
 */
const SETUP_HINT =
  'Copy apps/beta/.env.example to apps/beta/.env.local and fill in your Supabase project URL and publishable key. ' +
  'Both are in the Supabase dashboard under Project Settings → API.';

/** True when the app has been given a Supabase project to talk to. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

function required(
  name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set.\n\n${SETUP_HINT}`);
  }
  return value;
}

export function supabaseUrl(): string {
  return required('NEXT_PUBLIC_SUPABASE_URL');
}

export function supabasePublishableKey(): string {
  return required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
}

/**
 * Whether an unconfigured app should keep serving.
 *
 * In development, yes: someone who has just cloned the repository should be
 * able to open the marketing pages and read the setup message on the sign-in
 * page, rather than meeting a 500 on every route including the ones that never
 * touch a database.
 *
 * In production, no. A deployment with no Supabase project is a broken deploy,
 * and it should fail loudly at the first request rather than quietly serving a
 * site where nobody can ever sign in.
 *
 * This never affects authorization. An unconfigured app cannot verify a
 * session, so it treats every visitor as signed out — which is the same thing
 * it already does when Supabase is unreachable, and it admits nobody.
 */
export function toleratesMissingConfig(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export { SETUP_HINT };
