import { Section, SectionHeading, Card, ButtonLink, Chip, Media } from '@/components/ui/primitives';
import { Badge } from '@/components/ui/feedback';
import { ProgressBar } from '@/components/ui/charts';
import { relativeTime, formatNumber } from '@/lib/format';
import { apiPublic } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Community',
  description: 'Progress, questions, personal records and coach posts — from members who train like you.',
};

interface FeedPost {
  id: string;
  kind: string;
  body: string;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  author: { id: string; firstName: string; lastName: string; avatarKey: string | null };
  group: { slug: string; name: string } | null;
}

interface Group {
  slug: string; name: string; description: string; memberCount: number; imageKey: string;
}

interface Challenge {
  slug: string; name: string; tagline: string; metric: string; target: number;
  durationDays: number; badge: string; rules: string[]; participants: number;
}

export default async function CommunityPage() {
  const [{ posts }, { groups }, { challenges }] = await Promise.all([
    apiPublic<{ posts: FeedPost[] }>('/v1/community/feed?limit=6'),
    apiPublic<{ groups: Group[] }>('/v1/catalog/groups'),
    apiPublic<{ challenges: Challenge[] }>('/v1/catalog/challenges'),
  ]);

  return (
    <>
      <Section tone="dark" size="lg">
        <div className="max-w-4xl pt-16">
          <p className="eyebrow mb-6">Community</p>
          <h1 className="display text-display-lg text-balance">TRAIN ALONE. NOT BY YOURSELF.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-bone-200/70">
            Progress, questions, personal records and coach posts — from people running the same programmes you
            are. No transformation photos required, no before-and-after arms race.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <ButtonLink href="/assessment" size="lg">Join FORGE</ButtonLink>
            <ButtonLink href="#groups" variant="inverse" size="lg">See Groups</ButtonLink>
          </div>
        </div>
      </Section>

      <Section tone="light" size="md">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:gap-14">
          <div>
            <SectionHeading eyebrow="The feed" title="WHAT MEMBERS ARE POSTING." />
            <div className="mt-10 space-y-5">
              {posts.map((post) => (
                <Card key={post.id}>
                  <div className="flex items-start gap-4">
                    <span
                      aria-hidden
                      className="dark-surface grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink-900 text-xs font-semibold text-bone-100"
                    >
                      {post.author.firstName.charAt(0)}{post.author.lastName.charAt(0)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className="font-semibold">
                          {post.author.firstName} {post.author.lastName.charAt(0)}.
                        </span>
                        {post.group && (
                          <>
                            <span aria-hidden className="opacity-30">·</span>
                            <span className="text-muted">{post.group.name}</span>
                          </>
                        )}
                        <span aria-hidden className="opacity-30">·</span>
                        <span className="text-xs text-muted">{relativeTime(post.createdAt)}</span>
                      </div>

                      {post.kind === 'personal-record' && (
                        <div className="mt-3"><Badge>Personal record</Badge></div>
                      )}

                      <p className="mt-3 leading-relaxed opacity-85">{post.body}</p>

                      <div className="mt-4 flex items-center gap-5 text-xs text-muted">
                        <span><span aria-hidden>♡</span> {post.likeCount}</span>
                        <span><span aria-hidden>💬</span> {post.commentCount}</span>
                        <span><span aria-hidden>⌸</span> Save</span>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          <div className="space-y-6 lg:sticky lg:top-28 lg:self-start">
            <Card>
              <p className="eyebrow mb-4">Community rules</p>
              <ul className="space-y-3 text-sm">
                {[
                  'Process over outcome. Post what you did, not what you weigh.',
                  'No before-and-after weight claims, in posts or comments.',
                  'Questions from beginners get answered, not corrected.',
                  'Coaches identify themselves as coaches.',
                ].map((rule) => (
                  <li key={rule} className="flex gap-3">
                    <span aria-hidden className="text-accent">→</span>
                    <span className="text-muted">{rule}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card tone="dark">
              <p className="eyebrow mb-4">Live challenges</p>
              <ul className="space-y-5">
                {challenges.slice(0, 3).map((challenge) => (
                  <li key={challenge.slug}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-medium text-bone-100">{challenge.name}</p>
                      <span className="text-xs tabular-nums text-muted">
                        {formatNumber(challenge.participants)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">{challenge.tagline}</p>
                    <div className="mt-2">
                      <ProgressBar value={62} tone="accent" />
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <ButtonLink href="/assessment" variant="inverse" block size="sm">Join a Challenge</ButtonLink>
              </div>
            </Card>
          </div>
        </div>
      </Section>

      <Section tone="bone" size="md" id="groups">
        <SectionHeading eyebrow="Groups" title="FIND YOUR PEOPLE." />
        <div className="mt-10 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {groups.map((group) => (
            <Card key={group.slug} interactive>
              <div className="mb-5 overflow-hidden rounded-[10px]">
                <Media imageKey={group.imageKey} ratio="16/9" rounded={false} alt={group.name} />
              </div>
              <h3 className="display text-xl leading-none">{group.name}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{group.description}</p>
              <p className="mt-4 text-xs text-muted">{formatNumber(group.memberCount)} members</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section tone="dark" size="md">
        <SectionHeading
          eyebrow="Challenges"
          title="COMPETE WITH YOURSELF FIRST."
          lead="Every FORGE challenge measures an action you control — sessions, steps, minutes moved. None of them measure weight lost, and none of them ever will."
        />
        <div className="mt-12 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {challenges.map((challenge) => (
            <Card key={challenge.slug} tone="dark">
              <div className="flex items-start justify-between gap-3">
                <h3 className="display text-xl leading-none text-bone-100">{challenge.name}</h3>
                <Chip tone="inverse" size="sm">{challenge.durationDays}d</Chip>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-bone-200/65">{challenge.tagline}</p>
              <div className="mt-5">
                <Badge earned={false}>{challenge.badge}</Badge>
              </div>
              <ul className="mt-5 space-y-2">
                {challenge.rules.map((rule) => (
                  <li key={rule} className="flex gap-2.5 text-xs text-bone-200/55">
                    <span aria-hidden className="text-accent">·</span>
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-xs text-muted">
                {formatNumber(challenge.participants)} members taking part
              </p>
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}
