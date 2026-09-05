'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { Button, Card, Chip } from '@/components/ui/primitives';
import { formatSeconds } from '@/lib/format';
import { TimeAgo } from '@/components/app/time-ago';
import { generateImage } from '@/lib/imagery';

interface Message {
  id: string; senderId: string; kind: string; body: string | null;
  mediaKey: string | null; durationSeconds: number | null; exerciseId: string | null;
  createdAt: string; readAt: string | null;
  formCheckComments: { id: string; timestampSeconds: number; body: string }[];
}

/**
 * Coach messaging.
 *
 * Text, voice notes and form checks in one thread. A form check renders as a
 * video surface with the coach's notes pinned to their timestamps — that is the
 * feature the whole coaching tier is sold on, so it is not a file attachment
 * with a caption.
 */
export function MessageThread({
  threadId,
  currentUserId,
  messages,
  coachName,
}: {
  threadId: string;
  currentUserId: string;
  messages: Message[];
  coachName: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);

  const send = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.trim().length === 0) return;
    setPending(true);
    const response = await fetch(`/api/v1/me/messages/${threadId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'text', body: draft.trim() }),
    });
    setPending(false);
    if (response.ok) {
      setDraft('');
      router.refresh();
    }
  };

  const sendFormCheck = async () => {
    setPending(true);
    await fetch(`/api/v1/me/messages/${threadId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'form-check',
        body: 'Form check — top set.',
        mediaKey: `form-check-${Date.now()}`,
        durationSeconds: 22,
        exerciseId: 'barbell-back-squat',
      }),
    });
    setPending(false);
    router.refresh();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
      <Card padded={false}>
        <ul className="max-h-[62vh] space-y-5 overflow-y-auto p-6">
          {messages.map((message) => {
            const mine = message.senderId === currentUserId;
            return (
              <li key={message.id} className={clsx('flex', mine ? 'justify-end' : 'justify-start')}>
                <div className={clsx('max-w-[85%]', mine ? 'items-end' : 'items-start')}>
                  {message.kind === 'form-check' ? (
                    <FormCheck message={message} coachName={coachName} />
                  ) : message.kind === 'voice' ? (
                    <VoiceNote message={message} mine={mine} />
                  ) : (
                    <p
                      className={clsx(
                        'rounded-card px-5 py-3.5 text-sm leading-relaxed',
                        mine ? 'dark-surface rounded-tr-sm bg-ink-900 text-bone-100' : 'rounded-tl-sm bg-ink-900/[0.05]',
                      )}
                    >
                      {message.body}
                    </p>
                  )}
                  <p className={clsx('mt-1.5 text-[0.6875rem] text-muted', mine ? 'text-right' : '')}>
                    <TimeAgo iso={message.createdAt} />
                    {mine && message.readAt && ' · Read'}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>

        <form onSubmit={send} className="flex items-center gap-3 border-t border-ink-900/10 p-4">
          <label htmlFor="message-draft" className="sr-only">Message {coachName}</label>
          <input
            id="message-draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`Message ${coachName}…`}
            className="min-h-[48px] flex-1 rounded-pill border border-ink-900/15 px-5 text-sm transition-colors focus:border-ember"
          />
          <Button type="submit" disabled={pending || draft.trim().length === 0}>Send</Button>
        </form>
      </Card>

      <aside aria-label="Conversation tools" className="space-y-6">
        <Card>
          <p className="eyebrow mb-4">Send a form check</p>
          <p className="text-sm leading-relaxed text-muted">
            Film one working set from the side. {coachName} adds notes pinned to the exact second where the
            position changes.
          </p>
          <div className="mt-5">
            <Button variant="secondary" block onClick={() => void sendFormCheck()} disabled={pending}>
              Send Form Check
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted">
            In this prototype the clip is simulated; the timestamped review flow is real.
          </p>
        </Card>

        <Card>
          <p className="eyebrow mb-4">Attach</p>
          <ul className="space-y-2 text-sm">
            {['Voice note', 'Video', 'Photo', 'Document'].map((label) => (
              <li key={label}>
                <button
                  type="button"
                  disabled
                  className="w-full rounded-[8px] border border-ink-900/10 px-4 py-3 text-left text-muted"
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </aside>
    </div>
  );
}

function FormCheck({ message, coachName }: { message: Message; coachName: string }) {
  const [time, setTime] = useState(0);
  const duration = message.durationSeconds ?? 20;
  const backdrop = generateImage(message.mediaKey ?? 'form-check');
  const active = message.formCheckComments.find(
    (comment) => Math.abs(comment.timestampSeconds - time) <= 2,
  );

  return (
    <div className="light-surface w-[min(420px,80vw)] overflow-hidden rounded-card border border-ink-900/12 bg-bone-100">
      <div className="grain relative aspect-video" style={{ background: backdrop.background }}>
        <div className="absolute inset-0 grid place-items-center">
          <span aria-hidden className="grid h-12 w-12 place-items-center rounded-full bg-bone-100/95 text-ink-900">▶</span>
        </div>
        {active && (
          <p className="absolute inset-x-3 bottom-3 rounded-[8px] bg-ink-900/90 p-3 text-xs leading-relaxed text-bone-100">
            <span className="mr-2 font-mono text-muted">{formatSeconds(active.timestampSeconds)}</span>
            {active.body}
          </p>
        )}
      </div>

      <div className="p-4">
        {message.exerciseId && (
          <Chip size="sm">{message.exerciseId.replace(/-/g, ' ')}</Chip>
        )}
        {message.body && <p className="mt-3 text-sm">{message.body}</p>}

        <label htmlFor={`scrub-${message.id}`} className="sr-only">Scrub video</label>
        <input
          id={`scrub-${message.id}`}
          type="range"
          min={0}
          max={duration}
          value={time}
          onChange={(event) => setTime(Number(event.target.value))}
          className="mt-4 w-full accent-[#E8462B]"
        />
        <div className="flex justify-between text-[0.625rem] tabular-nums text-muted">
          <span>{formatSeconds(time)}</span>
          <span>{formatSeconds(duration)}</span>
        </div>

        {message.formCheckComments.length > 0 && (
          <div className="mt-4 border-t border-ink-900/8 pt-3">
            <p className="eyebrow mb-3">{coachName}&rsquo;s notes</p>
            <ul className="space-y-2">
              {message.formCheckComments.map((comment) => (
                <li key={comment.id}>
                  <button
                    type="button"
                    onClick={() => setTime(comment.timestampSeconds)}
                    className="flex w-full gap-3 rounded-[6px] px-2 py-2 text-left text-xs transition-colors hover:bg-ink-900/[0.04]"
                  >
                    <span className="shrink-0 font-mono text-accent">{formatSeconds(comment.timestampSeconds)}</span>
                    <span className="text-muted">{comment.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function VoiceNote({ message, mine }: { message: Message; mine: boolean }) {
  const duration = message.durationSeconds ?? 30;
  // A deterministic waveform from the message id, so it does not reshuffle on
  // every render — a waveform that dances is a waveform nobody trusts.
  const bars = Array.from({ length: 32 }, (_, index) => {
    const seed = message.id.charCodeAt(index % message.id.length) + index * 7;
    return 25 + (seed % 70);
  });

  return (
    <div
      className={clsx(
        'flex items-center gap-3 rounded-card px-4 py-3',
        mine ? 'dark-surface rounded-tr-sm bg-ink-900 text-bone-100' : 'rounded-tl-sm bg-ink-900/[0.05]',
      )}
    >
      <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ember-600 text-bone-100">▶</span>
      <span aria-hidden className="flex h-8 flex-1 items-center gap-[2px]">
        {bars.map((height, index) => (
          <span
            key={index}
            className={clsx('w-[3px] rounded-pill', mine ? 'bg-bone-200/50' : 'bg-ink-900/25')}
            style={{ height: `${height}%` }}
          />
        ))}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted">{formatSeconds(duration)}</span>
      <span className="sr-only">Voice note, {duration} seconds</span>
    </div>
  );
}
