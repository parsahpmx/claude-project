import { AppSection, PageHeader } from '@/components/app/page-header';
import { ProgramBuilder } from '@/components/app/program-builder';
import { apiPublic } from '@/lib/api';
import type { Program } from '@/lib/types';

export const metadata = { title: 'Program builder' };

export const dynamic = 'force-dynamic';

export default async function CoachProgramsPage() {
  const [{ programs }, { exercises }] = await Promise.all([
    apiPublic<{ programs: Program[] }>('/v1/catalog/programs'),
    apiPublic<{ exercises: { id: string; name: string; pattern: string; compound: boolean; requires: string[] }[] }>(
      '/v1/catalog/exercises',
    ),
  ]);

  return (
    <AppSection>
      <PageHeader
        eyebrow="Program builder"
        title="BUILD THE WEEK"
        lead="Drag exercises into a day, set the prescription, and the same plan appears in your client's app. No PDF, no version drift."
      />
      <div className="mt-10">
        <ProgramBuilder templates={programs} exercises={exercises} />
      </div>
    </AppSection>
  );
}
