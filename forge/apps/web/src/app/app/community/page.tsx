import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card, Chip } from '@/components/ui/primitives';
import { CommunityFeed } from '@/components/app/community-feed';
import { apiFetch, apiPublic } from '@/lib/api';

export const metadata = { title: 'Community' };

export const dynamic = 'force-dynamic';

interface Post {
  id: string; kind: string; body: string; likeCount: number; commentCount: number;
  createdAt: string; likedByViewer: boolean; savedByViewer: boolean;
  author: { id: string; firstName: string; lastName: string; avatarKey: string | null };
  group: { slug: string; name: string } | null;
}

export default async function CommunityPage() {
  const [{ posts }, { groups }] = await Promise.all([
    apiFetch<{ posts: Post[] }>('/v1/community/feed?limit=20'),
    apiPublic<{ groups: { slug: string; name: string; description: string; memberCount: number }[] }>(
      '/v1/catalog/groups',
    ),
  ]);

  return (
    <AppSection>
      <PageHeader
        eyebrow="Community"
        title="THE FEED"
        lead="Progress, questions and personal records from members running the same programmes you are."
      />

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <CommunityFeed posts={posts} groups={groups} />

        <aside className="space-y-6 lg:sticky lg:top-8 lg:self-start">
          <Card>
            <p className="eyebrow mb-4">Your groups</p>
            <ul className="space-y-3">
              {groups.slice(0, 7).map((group) => (
                <li key={group.slug} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{group.name}</p>
                    <p className="truncate text-xs text-muted">{group.description}</p>
                  </div>
                  <Chip size="sm">{Math.round(group.memberCount / 1000)}k</Chip>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <p className="eyebrow mb-4">House rules</p>
            <ul className="space-y-2.5 text-xs">
              {[
                'Process over outcome. Post what you did.',
                'No before-and-after weight claims.',
                'Beginner questions get answered, not corrected.',
                'Coaches identify themselves as coaches.',
              ].map((rule) => (
                <li key={rule} className="flex gap-2.5 text-muted">
                  <span aria-hidden className="text-accent">·</span>
                  {rule}
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </AppSection>
  );
}
