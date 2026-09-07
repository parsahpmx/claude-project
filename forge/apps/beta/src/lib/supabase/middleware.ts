import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import {
  isSupabaseConfigured,
  supabasePublishableKey,
  supabaseUrl,
  toleratesMissingConfig,
} from './config';
import { isAuthEntryPath, requiresSession } from '../auth/route-access';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // A freshly cloned checkout has no .env.local — it is gitignored, because it
  // holds a project's keys. Middleware runs on every route, so without this the
  // whole site answers 500, including marketing pages that never touch a
  // database, and the message names an environment variable rather than the
  // file to create.
  //
  // Treating "not configured" exactly like "Supabase unreachable" keeps the
  // security properties: no session can be verified, so every visitor is
  // anonymous and every guarded route still redirects to sign-in. It admits
  // nobody. In production this does not apply — see toleratesMissingConfig.
  if (!isSupabaseConfigured() && toleratesMissingConfig()) {
    const path = request.nextUrl.pathname;
    if (requiresSession(path)) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('next', path);
      return NextResponse.redirect(url);
    }
    return response;
  }

  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() revalidates the token with Supabase rather than trusting the
  // cookie's contents, which is why it is used here instead of getSession().
  //
  // If Supabase cannot be reached, treat the visitor as signed out rather than
  // letting the exception escape: an unhandled throw here would turn an outage
  // into a 500 on every route, marketing pages included. Failing closed sends
  // people to /login, which is the safe direction — it never admits anyone to a
  // protected page on the strength of an error.
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }

  const path = request.nextUrl.pathname;
  const needsAuth = requiresSession(path);

  if (needsAuth && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Come back to where they were headed once they are in.
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  // A signed-in athlete has no use for the sign-in page.
  if (user && isAuthEntryPath(path)) {
    const url = request.nextUrl.clone();
    url.pathname = '/home';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
