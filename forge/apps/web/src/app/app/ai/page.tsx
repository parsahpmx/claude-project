import { AppSection, PageHeader } from '@/components/app/page-header';
import { AiChat } from '@/components/app/ai-chat';
import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ questions }, params] = await Promise.all([
    apiFetch<{ questions: string[] }>('/v1/ai/suggestions'),
    searchParams,
  ]);
  const initial = typeof params.q === 'string' ? params.q : null;

  return (
    <AppSection>
      <PageHeader
        eyebrow="FORGE AI"
        title="YOUR 24/7 TRAINING ASSISTANT."
        lead="Answers built from your plan, your training history, your readiness and your nutrition targets — and nothing else."
      />
      <div className="mt-10">
        <AiChat suggestions={questions} initialQuestion={initial} />
      </div>
    </AppSection>
  );
}
