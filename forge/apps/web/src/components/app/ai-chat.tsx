'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, Card, Chip } from '@/components/ui/primitives';
import { Skeleton } from '@/components/ui/feedback';
import type { AiAnswer } from '@/lib/types';

/**
 * FORGE AI.
 *
 * Answers arrive as structured cards, not prose: a headline, the reasoning, the
 * actions, and — always — the list of data the answer drew on. Showing sources
 * is what separates an assistant a member can check from one they have to
 * trust blindly.
 */

interface Turn {
  id: string;
  question: string;
  answer: AiAnswer | null;
  failed?: boolean;
}

const ACTION_HREF: Record<string, string> = {
  'open-coach-chat': '/app/messages',
  'open-check-in': '/app/coach',
  'swap-to-mobility': '/app/recovery',
  'open-recovery': '/app/recovery',
  'open-plan': '/app/plan',
  'start-workout': '/app/plan',
  'open-progress': '/app/progress',
  'open-nutrition': '/app/nutrition',
  'log-meal': '/app/nutrition',
  'open-equipment': '/app/settings',
  'open-wearables': '/app/settings',
  'open-coaching': '/coaching',
  'swap-session': '/app/plan',
  'adapt-session': '/app/plan',
};

export function AiChat({ suggestions, initialQuestion }: { suggestions: string[]; initialQuestion: string | null }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const asked = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  const ask = async (question: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setTurns((current) => [...current, { id, question, answer: null }]);
    setInput('');
    setPending(true);

    try {
      const response = await fetch('/api/v1/ai/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      if (!response.ok) throw new Error('ai failed');
      const body = (await response.json()) as { answer: AiAnswer };
      setTurns((current) => current.map((t) => (t.id === id ? { ...t, answer: body.answer } : t)));
    } catch {
      setTurns((current) => current.map((t) => (t.id === id ? { ...t, failed: true } : t)));
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    if (initialQuestion && !asked.current) {
      asked.current = true;
      void ask(initialQuestion);
    }
  }, [initialQuestion]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
      <div>
        {turns.length === 0 && (
          <Card tone="dark">
            <p className="display text-display-sm text-bone-100">ASK ME ANYTHING ABOUT YOUR TRAINING.</p>
            <p className="mt-4 text-sm leading-relaxed text-bone-200/65">
              I work from your plan, your logged sessions, your readiness and your nutrition targets. If I do
              not have the data to answer something, I will say so rather than guess.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-bone-200/65">
              I do not answer medical or injury questions. Those go to a qualified professional, every time.
            </p>
          </Card>
        )}

        <ul className="space-y-6">
          {turns.map((turn) => (
            <li key={turn.id}>
              <div className="flex justify-end">
                <p className="max-w-[80%] rounded-card rounded-tr-sm bg-ink-900 px-5 py-3.5 text-sm text-bone-100">
                  {turn.question}
                </p>
              </div>

              <div className="mt-4">
                {turn.failed ? (
                  <Card>
                    <p className="text-sm text-signal-bad">
                      <span aria-hidden>!</span> I could not reach the assistant. Try again in a moment.
                    </p>
                  </Card>
                ) : turn.answer ? (
                  <AnswerCard answer={turn.answer} />
                ) : (
                  <Card>
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="mt-3 h-4 w-full" />
                    <Skeleton className="mt-2 h-4 w-5/6" />
                  </Card>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div ref={bottom} />

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (input.trim().length > 0) void ask(input.trim());
          }}
          className="sticky bottom-4 mt-8 flex gap-3"
        >
          <label htmlFor="ai-input" className="sr-only">Ask FORGE AI</label>
          <input
            id="ai-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about today's session, your recovery, or what to eat…"
            className="min-h-[56px] flex-1 rounded-pill border border-ink-900/15 bg-bone-100 px-6 text-sm shadow-card transition-colors focus:border-ember"
          />
          <Button type="submit" size="lg" disabled={pending || input.trim().length === 0}>
            Ask
          </Button>
        </form>
      </div>

      <aside className="space-y-6 lg:sticky lg:top-8 lg:self-start">
        <Card>
          <p className="eyebrow mb-4">Try asking</p>
          <ul className="space-y-2">
            {suggestions.map((question) => (
              <li key={question}>
                <button
                  type="button"
                  onClick={() => void ask(question)}
                  disabled={pending}
                  className="w-full rounded-[8px] border border-ink-900/10 px-4 py-3 text-left text-sm transition-colors hover:border-ink-900/30 hover:bg-ink-900/[0.02] disabled:opacity-50"
                >
                  {question}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <p className="eyebrow mb-3">What I can see</p>
          <ul className="space-y-2 text-xs">
            {[
              'Your training history and logged sets',
              'Your current programme and this week',
              'Readiness, sleep, HRV and resting heart rate',
              'Your nutrition targets',
              'The equipment on your profile',
            ].map((item) => (
              <li key={item} className="flex gap-2.5 opacity-70">
                <span aria-hidden className="text-ember">·</span>
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs leading-relaxed opacity-50">
            FORGE AI does not replace a human coach. For anything about pain, injury or a medical condition,
            speak to a qualified healthcare professional.
          </p>
        </Card>
      </aside>
    </div>
  );
}

function AnswerCard({ answer }: { answer: AiAnswer }) {
  return (
    <Card>
      <div className="flex items-start gap-4">
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ember/12 text-ember">✦</span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-snug">{answer.headline}</h3>
          <div className="mt-3 space-y-3">
            {answer.body.map((paragraph, index) => (
              <p key={index} className="text-sm leading-relaxed opacity-80">{paragraph}</p>
            ))}
          </div>

          {answer.disclaimer && (
            <p className="mt-5 rounded-[8px] border border-signal-warn/25 bg-signal-warn/[0.07] p-4 text-xs leading-relaxed">
              {answer.disclaimer}
            </p>
          )}

          {answer.actions.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {answer.actions.map((action) => {
                const href = ACTION_HREF[action.action] ?? resolveDynamic(action.action);
                return href ? (
                  <Link
                    key={action.action}
                    href={href}
                    className="min-h-[40px] rounded-[8px] border border-ink-900/15 px-4 text-xs font-semibold uppercase leading-[38px] tracking-[0.08em] transition-colors hover:border-ink-900/45"
                  >
                    {action.label}
                  </Link>
                ) : (
                  <span
                    key={action.action}
                    className="min-h-[40px] rounded-[8px] border border-ink-900/10 px-4 text-xs uppercase leading-[38px] tracking-[0.08em] opacity-40"
                  >
                    {action.label}
                  </span>
                );
              })}
            </div>
          )}

          {answer.sources.length > 0 && (
            <div className="mt-5 border-t border-ink-900/8 pt-4">
              <p className="text-[0.625rem] uppercase tracking-[0.12em] opacity-45">Based on</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {answer.sources.map((source) => <Chip key={source} size="sm">{source}</Chip>)}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Actions of the form `shorten:30` or `substitute:a:b` route into the plan. */
function resolveDynamic(action: string): string | null {
  if (action.startsWith('shorten:') || action.startsWith('substitute')) return '/app/plan';
  return null;
}
