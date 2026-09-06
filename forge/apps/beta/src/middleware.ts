import type { NextRequest } from 'next/server';

// This file must live inside `src/` because the app does. At the project root
// Next does not pick it up and silently runs no middleware at all — which is
// how it was originally written, and why session refresh never happened.
import { updateSession } from './lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static assets and image files.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
