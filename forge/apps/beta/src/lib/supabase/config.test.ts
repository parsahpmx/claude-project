import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSupabaseConfigured, supabaseUrl, toleratesMissingConfig } from './config';

const KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('supabase configuration', () => {
  it('reports configured only when both values are present', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x';
    expect(isSupabaseConfigured()).toBe(true);

    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    expect(isSupabaseConfigured()).toBe(false);

    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(isSupabaseConfigured()).toBe(false);
  });

  /**
   * Regression: a fresh clone has no .env.local, because it is gitignored, and
   * every route answered 500 with "NEXT_PUBLIC_SUPABASE_URL is not set" — a
   * message that names a variable rather than the file to create.
   */
  it('tells the reader which file to create', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(() => supabaseUrl()).toThrow(/\.env\.example/);
    expect(() => supabaseUrl()).toThrow(/\.env\.local/);
  });

  it('degrades in development but never in production', () => {
    // Serving marketing pages to someone mid-setup is helpful; doing it in
    // production would hide a broken deploy where nobody can sign in.
    vi.stubEnv('NODE_ENV', 'development');
    expect(toleratesMissingConfig()).toBe(true);

    vi.stubEnv('NODE_ENV', 'production');
    expect(toleratesMissingConfig()).toBe(false);

    vi.unstubAllEnvs();
  });
});
