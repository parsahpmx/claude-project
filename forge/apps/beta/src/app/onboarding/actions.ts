'use server';

import { revalidatePath } from 'next/cache';
import { onboardingSchema } from '@forge/contracts';
import { createClient } from '@/lib/supabase/server';

export interface OnboardingResult { error?: string }

/**
 * Onboarding edits the profile and privacy rows the auth trigger already
 * created, rather than creating them. That means a half-finished onboarding
 * leaves an account with safe defaults instead of no settings at all.
 */
export async function completeOnboarding(input: unknown): Promise<OnboardingResult> {
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Some answers were not valid.' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Log in and try again.' };

  const { displayName, sports, profileVisibility } = parsed.data;

  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      display_name: displayName,
      primary_sport: sports[0] ?? null,
      onboarded_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  if (profileError) return { error: 'We could not save your profile. Try again.' };

  const { error: privacyError } = await supabase
    .from('privacy_settings')
    .update({
      profile_visibility: profileVisibility,
      // Activities follow the profile unless the athlete narrows them later,
      // and never start more open than the profile itself.
      default_activity_visibility: profileVisibility === 'public' ? 'followers' : profileVisibility,
    })
    .eq('user_id', user.id);

  if (privacyError) return { error: 'We could not save your privacy settings. Try again.' };

  revalidatePath('/', 'layout');
  return {};
}
