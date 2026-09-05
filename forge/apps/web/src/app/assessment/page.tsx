import Link from 'next/link';
import { AssessmentFlow } from '@/components/marketing/assessment-flow';
import { apiPublic } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Fitness Assessment',
  description: 'Ten questions, about two minutes, and a full twelve-week plan at the end.',
};

interface Step {
  id: string;
  index: number;
  eyebrow: string;
  question: string;
  helper: string;
  kind: 'single' | 'multi' | 'number';
  options: { value: string; label: string; description?: string }[];
  optional: boolean;
}

export default async function AssessmentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ steps }, params] = await Promise.all([
    apiPublic<{ steps: Step[]; totalSteps: number }>('/v1/catalog/assessment-steps'),
    searchParams,
  ]);

  // The homepage preview passes what it already asked, so nobody answers twice.
  const prefill: Record<string, string[]> = {};
  const carry: Record<string, string> = { goal: 'primaryGoal', experience: 'experience', location: 'location', equipment: 'equipment' };
  for (const [param, stepId] of Object.entries(carry)) {
    const value = params[param];
    if (typeof value === 'string' && value.length > 0) prefill[stepId] = value.split(',');
  }

  return (
    <div className="dark-surface min-h-dvh bg-ink-900 text-bone-200">
      <header className="border-b border-bone-200/10">
        <div className="shell flex h-[72px] items-center justify-between">
          <Link href="/" className="display text-xl tracking-[0.08em] text-bone-100">FORGE</Link>
          <Link href="/" className="text-xs uppercase tracking-[0.12em] text-muted hover:text-bone-100">
            Save &amp; exit
          </Link>
        </div>
      </header>

      <main id="main">
        <AssessmentFlow steps={steps} prefill={prefill} />
      </main>
    </div>
  );
}
