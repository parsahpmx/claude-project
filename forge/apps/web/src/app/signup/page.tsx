import Link from 'next/link';
import { CheckoutFlow } from '@/components/marketing/checkout-flow';
import { apiPublic } from '@/lib/api';
import type { PlanTierDefinition } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Start Your Free Trial',
  description: 'Create your account and start your seven-day free trial.',
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ plans }, params] = await Promise.all([
    apiPublic<{ plans: PlanTierDefinition[] }>('/v1/catalog/plans'),
    searchParams,
  ]);

  const single = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' ? value : undefined;
  };

  const answers: Record<string, string[]> = {};
  for (const key of ['primaryGoal', 'secondaryGoals', 'ageRange', 'experience', 'daysPerWeek', 'sessionMinutes', 'location', 'equipment', 'diet', 'coaching']) {
    const value = single(key);
    if (value) answers[key] = value.split(',');
  }

  return (
    <div className="dark-surface min-h-dvh bg-ink-900 text-bone-200">
      <header className="border-b border-bone-200/10">
        <div className="shell flex h-[72px] items-center justify-between">
          <Link href="/" className="display text-xl tracking-[0.08em] text-bone-100">FORGE</Link>
          <Link href="/signin" className="text-xs uppercase tracking-[0.12em] text-bone-200/50 hover:text-bone-100">
            Already a member?
          </Link>
        </div>
      </header>

      <main id="main">
        <CheckoutFlow
          plans={plans}
          initialTier={single('plan') ?? 'forge-pro'}
          initialInterval={single('interval') === 'yearly' ? 'yearly' : 'monthly'}
          answers={answers}
          programSlug={single('program') ?? null}
          coachSlug={single('coach') ?? null}
        />
      </main>
    </div>
  );
}
