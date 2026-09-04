import { AppSection, PageHeader } from '@/components/app/page-header';
import { ProgramFilters } from '@/components/marketing/program-filters';
import { StartProgramNotice } from '@/components/app/start-program-notice';
import { apiPublic } from '@/lib/api';
import type { Program } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AppProgramsPage() {
  const { programs, facets } = await apiPublic<{
    programs: Program[];
    facets: {
      goals: { value: string; label: string }[];
      styles: { value: string; label: string }[];
      equipment: { value: string; label: string }[];
      durations: number[];
    };
  }>('/v1/catalog/programs');

  return (
    <AppSection>
      <PageHeader
        eyebrow="Programs"
        title="WHAT DO YOU WANT TO TRAIN?"
        lead="Starting a new programme archives your current plan — your history, records and progress stay exactly where they are."
      />
      <div className="mt-8"><StartProgramNotice /></div>
      <div className="mt-10">
        <ProgramFilters programs={programs} facets={facets} />
      </div>
    </AppSection>
  );
}
