import { notFound } from 'next/navigation';
import { WorkoutPlayer } from '@/components/app/workout-player';
import { ApiRequestError, apiFetch } from '@/lib/api';
import type { BuiltSession, PlanDay } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function WorkoutPage({ params }: { params: Promise<{ dayId: string }> }) {
  const { dayId } = await params;

  let data: { day: PlanDay; session: BuiltSession | null };
  try {
    data = await apiFetch<{ day: PlanDay; session: BuiltSession | null }>(`/v1/me/plan/days/${dayId}`);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    throw error;
  }

  if (!data.session) notFound();

  return <WorkoutPlayer day={data.day} session={data.session} />;
}
