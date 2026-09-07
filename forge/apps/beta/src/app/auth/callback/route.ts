import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { RECOVERY_COOKIE, RECOVERY_PATH, RECOVERY_WINDOW_SECONDS } from '@/lib/auth/recovery';
import { siteOriginFrom } from '@/lib/auth/site-origin';

/**
 * Email confirmation and OAuth land here. The `next` parameter is validated as
 * a local path before it is used, so the callback cannot be turned into an open
 * redirect by appending someone else's host to the link.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  // Not `request.nextUrl.origin`: that is the origin the *server* saw, and
  // redirecting to it can cross a cookie boundary and drop the session that was
  // just established. See lib/auth/site-origin.ts.
  const origin = siteOriginFrom(request.headers, request.nextUrl.origin);
  const code = searchParams.get('code');
  const rawNext = searchParams.get('next') ?? '/home';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/home';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
  }

  const response = NextResponse.redirect(`${origin}${next}`);

  // Setting a new password without knowing the old one is only reasonable for
  // someone who proved control of the mailbox. An ordinary session is not that
  // proof: a borrowed or stolen one would otherwise be enough to change the
  // password and lock the real owner out of their own account.
  //
  // Only this route sets the cookie, and only after exchanging a code that came
  // from an email we sent, so its presence is the proof. httpOnly keeps it away
  // from scripts, and the short lifetime keeps the window narrow.
  if (next === RECOVERY_PATH) {
    response.cookies.set(RECOVERY_COOKIE, '1', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: RECOVERY_WINDOW_SECONDS,
    });
  }

  return response;
}
