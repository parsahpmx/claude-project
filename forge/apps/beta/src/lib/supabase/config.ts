/**
 * Environment access, in one place.
 *
 * Only the URL and the publishable key are ever read here. The service role key
 * is not read, not typed and not referenced anywhere in this app: a key that has
 * no code path cannot be leaked by one.
 */

export function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  return url;
}

export function supabasePublishableKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set');
  return key;
}
