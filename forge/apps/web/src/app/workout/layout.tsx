import { redirect } from 'next/navigation';
import { apiFetchOptional } from '@/lib/api';
import type { SessionUser } from '@/lib/types';

/**
 * The workout player sits outside the application shell on purpose.
 *
 * Mid-set, the only things that should be on screen are the movement, the
 * target and the control that logs the set. A sidebar full of other places to
 * be is exactly the wrong thing to offer somebody under a loaded barbell.
 */
export default async function WorkoutLayout({ children }: { children: React.ReactNode }) {
  const session = await apiFetchOptional<{ user: SessionUser }>('/v1/auth/me');
  if (!session) redirect('/signin');
  return <>{children}</>;
}
