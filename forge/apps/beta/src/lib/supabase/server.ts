import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabasePublishableKey, supabaseUrl } from './config';

/**
 * Server client, for Server Components, Server Actions and Route Handlers.
 *
 * It uses the same publishable key as the browser and reads the session from
 * cookies, so server-rendered queries run under the same RLS as client ones.
 * There is deliberately no service-role variant here: if a query needs to
 * bypass RLS, that is a design smell to fix in a policy, not a key to reach for.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

/** The signed-in user, or null. Never throws for an anonymous visitor. */
export async function getUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}
