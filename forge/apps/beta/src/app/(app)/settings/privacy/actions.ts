'use server';

import { revalidatePath } from 'next/cache';
import { privacyUpdateSchema } from '@forge/contracts';
import { createClient } from '@/lib/supabase/server';

export interface PrivacyResult {
  error?: string;
}

/** Column names are mapped explicitly, so a stray key cannot reach the update. */
const COLUMN: Record<string, string> = {
  profileVisibility: 'profile_visibility',
  defaultActivityVisibility: 'default_activity_visibility',
  routeVisibility: 'route_visibility',
  requireFollowApproval: 'require_follow_approval',
  hideStartEnd: 'hide_start_end',
  hideRadiusM: 'hide_radius_m',
  coachSharing: 'coach_sharing',
  aggregateContribution: 'aggregate_contribution',
  analyticsConsent: 'analytics_consent',
  aiConsent: 'ai_consent',
};

export async function updatePrivacy(patch: unknown): Promise<PrivacyResult> {
  const parsed = privacyUpdateSchema.safeParse(patch);
  if (!parsed.success) return { error: 'That setting could not be saved.' };

  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    const column = COLUMN[key];
    if (column && value !== undefined) update[column] = value;
  }
  if (Object.keys(update).length === 0) return {};

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Log in and try again.' };

  // RLS restricts this to the caller's own row anyway; the explicit eq() is
  // belt and braces, and makes the intent readable at the call site.
  const { error } = await supabase.from('privacy_settings').update(update).eq('user_id', user.id);

  if (error) return { error: 'We could not save that. Try again in a moment.' };

  revalidatePath('/settings/privacy');
  return {};
}
