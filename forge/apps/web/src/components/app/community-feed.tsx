'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { Button, Card, Chip } from '@/components/ui/primitives';
import { TextArea } from '@/components/ui/forms';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { TimeAgo } from '@/components/app/time-ago';

interface Post {
  id: string; kind: string; body: string; likeCount: number; commentCount: number;
  createdAt: string; likedByViewer: boolean; savedByViewer: boolean;
  author: { id: string; firstName: string; lastName: string; avatarKey: string | null };
  group: { slug: string; name: string } | null;
}

export function CommunityFeed({
  posts,
  groups,
}: {
  posts: Post[];
  groups: { slug: string; name: string }[];
}) {
  const [items, setItems] = useState(posts);
  const [group, setGroup] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [posting, setPosting] = useState(false);

  const visible = group ? items.filter((post) => post.group?.slug === group) : items;

  const toggleLike = async (id: string) => {
    // Optimistic, then reconciled with the server's authoritative answer.
    setItems((current) =>
      current.map((post) =>
        post.id === id
          ? {
              ...post,
              likedByViewer: !post.likedByViewer,
              likeCount: post.likeCount + (post.likedByViewer ? -1 : 1),
            }
          : post,
      ),
    );
    const response = await fetch(`/api/v1/community/posts/${id}/like`, { method: 'POST' });
    if (!response.ok) return;
    const body = (await response.json()) as { liked: boolean };
    setItems((current) =>
      current.map((post) => (post.id === id ? { ...post, likedByViewer: body.liked } : post)),
    );
  };

  const toggleSave = async (id: string) => {
    setItems((current) =>
      current.map((post) => (post.id === id ? { ...post, savedByViewer: !post.savedByViewer } : post)),
    );
    await fetch(`/api/v1/community/posts/${id}/save`, { method: 'POST' });
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = String(form.get('body') ?? '').trim();
    if (body.length === 0) return;

    setPosting(true);
    const response = await fetch('/api/v1/community/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body, groupSlug: group ?? undefined, kind: 'update' }),
    });
    setPosting(false);
    if (!response.ok) return;

    const created = (await response.json()) as { id: string };
    setItems((current) => [
      {
        id: created.id, kind: 'update', body, likeCount: 0, commentCount: 0,
        createdAt: new Date().toISOString(), likedByViewer: false, savedByViewer: false,
        author: { id: 'me', firstName: 'You', lastName: '', avatarKey: null },
        group: group ? { slug: group, name: groups.find((g) => g.slug === group)?.name ?? group } : null,
      },
      ...current,
    ]);
    setComposing(false);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={group === null}
          onClick={() => setGroup(null)}
          className={chipClass(group === null)}
        >
          All
        </button>
        {groups.map((entry) => (
          <button
            key={entry.slug}
            type="button"
            aria-pressed={group === entry.slug}
            onClick={() => setGroup(entry.slug)}
            className={chipClass(group === entry.slug)}
          >
            {entry.name}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {composing ? (
          <Card>
            <form onSubmit={submit} className="space-y-4">
              <TextArea
                label="Share an update"
                name="body"
                required
                hint="What you did, what you learned, or what you are stuck on."
              />
              <div className="flex gap-3">
                <Button type="submit" disabled={posting}>{posting ? 'Posting…' : 'Post'}</Button>
                <Button type="button" variant="ghost" onClick={() => setComposing(false)}>Cancel</Button>
              </div>
            </form>
          </Card>
        ) : (
          <Button variant="ghost" block onClick={() => setComposing(true)}>
            Share an update…
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon="◎" title="Nothing here yet" body="Be the first to post in this group." />
        </div>
      ) : (
        <ul className="mt-6 space-y-5">
          {visible.map((post) => (
            <li key={post.id}>
              <Card>
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
                        {post.author.firstName} {post.author.lastName.charAt(0)}
                        {post.author.lastName ? '.' : ''}
                      </span>
                      {post.group && (
                        <>
                          <span aria-hidden className="opacity-30">·</span>
                          <span className="text-muted">{post.group.name}</span>
                        </>
                      )}
                      <span aria-hidden className="opacity-30">·</span>
                      <span className="text-xs text-muted"><TimeAgo iso={post.createdAt} /></span>
                    </div>

                    {post.kind === 'personal-record' && <div className="mt-3"><Badge>Personal record</Badge></div>}
                    {post.kind === 'question' && <div className="mt-3"><Chip size="sm">Question</Chip></div>}

                    <p className="mt-3 leading-relaxed opacity-85">{post.body}</p>

                    <div className="mt-4 flex items-center gap-4 text-xs">
                      <button
                        type="button"
                        onClick={() => void toggleLike(post.id)}
                        aria-pressed={post.likedByViewer}
                        className={clsx(
                          'flex min-h-[36px] items-center gap-1.5 rounded-pill px-3 transition-colors',
                          post.likedByViewer ? 'text-accent' : 'text-muted hover:text-ink-900',
                        )}
                      >
                        <span aria-hidden>{post.likedByViewer ? '♥' : '♡'}</span>
                        {post.likeCount}
                        <span className="sr-only">likes</span>
                      </button>
                      <span className="flex items-center gap-1.5 text-muted">
                        <span aria-hidden>💬</span> {post.commentCount}
                      </span>
                      <button
                        type="button"
                        onClick={() => void toggleSave(post.id)}
                        aria-pressed={post.savedByViewer}
                        className={clsx(
                          'flex min-h-[36px] items-center gap-1.5 rounded-pill px-3 transition-colors',
                          post.savedByViewer ? 'text-accent' : 'text-muted hover:text-ink-900',
                        )}
                      >
                        <span aria-hidden>{post.savedByViewer ? '★' : '☆'}</span>
                        {post.savedByViewer ? 'Saved' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function chipClass(active: boolean): string {
  return clsx(
    'min-h-[40px] rounded-pill border px-4 text-xs font-medium transition-all duration-200',
    active ? 'dark-surface border-ink-900 bg-ink-900 text-bone-100' : 'border-ink-900/15 hover:border-ink-900/40',
  );
}
