'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const credentials = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters'),
  next: z.string().startsWith('/').optional(),
});

export interface AuthState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Set when an action succeeded without navigating, so the form can say so. */
  notice?: string;
}

/**
 * The origin to build emailed links from.
 *
 * `NEXT_PUBLIC_SITE_URL` wins when set, because behind a proxy the request host
 * is whatever the proxy forwarded and a reset link pointing at an internal
 * hostname is a link nobody can open. Falling back to the request's own host
 * keeps local development and preview deployments working with no config.
 *
 * Supabase only redirects to URLs on its allow-list, so a forged Host header
 * cannot turn this into a link to an attacker's site — but the allow-list has
 * to actually be configured; see docs/production-security-checklist.md.
 */
async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, '');

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3100';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** One place that turns Zod issues into per-field messages. */
function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

/**
 * Supabase returns deliberately vague messages for sign-in failures so that an
 * attacker cannot use the form to discover which addresses have accounts. We
 * keep that property and say the same thing for a wrong password and an unknown
 * address, while still being specific about problems the person can fix.
 */
function readableAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials'))
    return 'That email and password do not match an account.';
  if (m.includes('email not confirmed'))
    return 'Check your inbox and confirm your email address first.';
  if (m.includes('already registered') || m.includes('already been registered')) {
    return 'There is already an account with that email. Try logging in.';
  }
  if (m.includes('rate limit') || m.includes('too many'))
    return 'Too many attempts. Wait a minute and try again.';
  return 'We could not complete that. Try again in a moment.';
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') || undefined,
  });

  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) return { error: readableAuthError(error.message) };

  revalidatePath('/', 'layout');
  redirect(parsed.data.next ?? '/home');
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  const displayName = String(formData.get('displayName') ?? '')
    .trim()
    .slice(0, 60);

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { display_name: displayName } },
  });

  if (error) return { error: readableAuthError(error.message) };

  revalidatePath('/', 'layout');
  // The profile and privacy rows already exist — the auth trigger created them
  // with conservative defaults, so onboarding edits rather than creates.
  redirect('/onboarding');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/');
}

// ---------------------------------------------------------------------------
// Password recovery
// ---------------------------------------------------------------------------

const resetRequest = z.object({
  email: z.string().email('Enter a valid email address'),
});

/**
 * The generic answer to "send me a reset link".
 *
 * Deliberately identical whether or not an account exists. A form that says
 * "no account with that email" is an account-enumeration oracle: an attacker
 * walks a list of addresses and learns which ones are registered. So the happy
 * path, the unknown-address path and most failure paths all return this same
 * sentence, and the only thing that varies is what happened server-side.
 */
const RESET_NOTICE =
  "If an account exists for that email, we've sent password reset instructions. Check your inbox.";

export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = resetRequest.safeParse({ email: formData.get('email') });

  // A malformed address is the one thing worth saying plainly: it is a mistake
  // the person can see and fix, and it reveals nothing about who has an account.
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    // Supabase sends a code; the existing callback exchanges it for a session
    // and forwards here, which is what makes /reset-password reachable exactly
    // once per link and only by whoever opened the email.
    redirectTo: `${await siteOrigin()}/auth/callback?next=/reset-password`,
  });

  // Rate limiting is the one condition worth surfacing, because repeating the
  // request is exactly the wrong response to it and the person needs to know
  // to wait. Everything else — including an unknown address — stays generic.
  if (error && /rate limit|too many/i.test(error.message)) {
    return { error: 'Too many attempts. Wait a minute and try again.' };
  }

  return { notice: RESET_NOTICE };
}

const newPassword = z
  .object({
    password: z.string().min(8, 'Use at least 8 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Both passwords must match',
    path: ['confirm'],
  });

/**
 * Set a new password.
 *
 * Reachable only with a recovery session, which the callback established from
 * the emailed code. Without one `getUser()` returns nothing and this refuses —
 * so an expired or already-used link cannot change anybody's password.
 */
export async function updatePassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = newPassword.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });

  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  const supabase = await createClient();

  const { data, error: sessionError } = await supabase.auth.getUser();
  if (sessionError || !data.user) {
    return {
      error: 'That reset link has expired or has already been used. Request a new one.',
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: readableAuthError(error.message) };

  revalidatePath('/', 'layout');
  redirect('/home');
}
