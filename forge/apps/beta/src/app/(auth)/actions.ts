'use server';

import { redirect } from 'next/navigation';
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

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors };
  }

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

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors };
  }

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
