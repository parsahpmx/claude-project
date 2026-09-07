'use client';

import { createBrowserClient } from '@supabase/ssr';
import { supabasePublishableKey, supabaseUrl } from './config';

/**
 * Browser client. Carries the publishable key and the user's session, so every
 * query it makes is subject to RLS as that user — which is the point: the
 * browser is never trusted, the database decides.
 */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabasePublishableKey());
}
