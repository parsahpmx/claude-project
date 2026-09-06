import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { supabasePublishableKey, supabaseUrl } from './config';

/** Routes that require a session. Everything else is public. */
const PROTECTED = [
  '/home',
  '/feed',
  '/activities',
  '/activity',
  '/maps',
  '/routes',
  '/route',
  '/training',
  '/programs',
  '/progress',
  '/goals',
  '/community',
  '/you',
  '/settings',
  '/onboarding',
];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

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
  const needsAuth = PROTECTED.some((p) => path === p || path.startsWith(`${p}/`));

  if (needsAuth && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Come back to where they were headed once they are in.
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  // A signed-in athlete has no use for the sign-in page.
  if (user && (path === '/login' || path === '/signup')) {
    const url = request.nextUrl.clone();
    url.pathname = '/home';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
