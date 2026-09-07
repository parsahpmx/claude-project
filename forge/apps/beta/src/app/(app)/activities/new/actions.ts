'use server';

import { revalidatePath } from 'next/cache';
import { activityCreateSchema } from '@forge/contracts';
import { createClient } from '@/lib/supabase/server';

export interface CreateResult {
  id?: string;
  error?: string;
}

export async function createActivity(formData: FormData): Promise<CreateResult> {
  const movingMinutes = Number(formData.get('movingMinutes') ?? 0);
  const distanceKm = Number(formData.get('distanceKm') ?? 0);
  const startedRaw = String(formData.get('startedAt') ?? '');

  // A datetime-local field has no timezone. Treating it as UTC is a lie that
  // shifts every activity; treating it as the browser's local time is what the
  // person meant, so the value is converted before validation.
  const startedAt = startedRaw ? new Date(startedRaw).toISOString() : '';

  const parsed = activityCreateSchema.safeParse({
    sport: formData.get('sport'),
    title: String(formData.get('title') ?? '').trim(),
    description: String(formData.get('description') ?? ''),
    startedAt,
    elapsedS: Math.round(movingMinutes * 60),
    movingS: Math.round(movingMinutes * 60),
    distanceM: Math.round(distanceKm * 1000),
    elevationGainM: Number(formData.get('elevationGainM') ?? 0) || 0,
    avgHr: formData.get('avgHr') ? Number(formData.get('avgHr')) : null,
    maxHr: null,
    calories: null,
    visibility: formData.get('visibility') || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Log in and try again.' };

  const { data, error } = await supabase
    .from('activities')
    .insert({
      user_id: user.id,
      sport: parsed.data.sport,
      title: parsed.data.title,
      description: parsed.data.description,
      started_at: parsed.data.startedAt,
      elapsed_s: parsed.data.elapsedS,
      moving_s: parsed.data.movingS,
      distance_m: parsed.data.distanceM,
      elevation_gain_m: parsed.data.elevationGainM,
      avg_hr: parsed.data.avgHr,
      visibility: parsed.data.visibility ?? 'followers',
      source: 'web',
      has_gps: false,
      processed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) return { error: 'We could not save that activity. Try again.' };

  revalidatePath('/home');
  revalidatePath('/activities');
  return { id: data.id };
}
