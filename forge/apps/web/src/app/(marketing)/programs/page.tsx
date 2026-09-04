import { Section } from '@/components/ui/primitives';
import { ProgramFilters } from '@/components/marketing/program-filters';
import { apiPublic } from '@/lib/api';
import type { Program } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Programs',
  description: 'Twelve structured training programmes, each with a phase plan and a coach behind it.',
};

interface Facets {
  goals: { value: string; label: string }[];
  styles: { value: string; label: string }[];
  equipment: { value: string; label: string }[];
  durations: number[];
}

export default async function ProgramsPage() {
  const { programs, facets } = await apiPublic<{ programs: Program[]; facets: Facets }>(
    '/v1/catalog/programs',
  );

  return (
    <>
      <Section tone="dark" size="lg">
        <div className="pt-16">
          <p className="eyebrow mb-6">Program library</p>
          <h1 className="display max-w-4xl text-display-lg text-balance">
            WHAT DO YOU WANT TO TRAIN?
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-bone-200/70">
            Every programme carries a phase plan, a progression model and an equipment list you can check
            against your own setup before you start.
          </p>
        </div>
      </Section>

      <Section tone="light" size="md">
        <ProgramFilters programs={programs} facets={facets} />
      </Section>
    </>
  );
}
