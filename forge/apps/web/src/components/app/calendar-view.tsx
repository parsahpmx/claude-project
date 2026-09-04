'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';

import { Tabs } from '@/components/ui/forms';
import { formatDateLabel } from '@/lib/format';

interface CalendarEvent {
  id: string; kind: string; title: string; date: string;
  startMinutes: number; durationMinutes: number; status: string; referenceId: string | null;
}

const KIND_TONE: Record<string, string> = {
  workout: 'border-ember/35 bg-ember/[0.09] text-ember-600',
  recovery: 'border-signal-info/30 bg-signal-info/[0.08] text-signal-info',
  'coach-session': 'border-signal-good/30 bg-signal-good/[0.08] text-signal-good',
  meal: 'border-ink-900/12 bg-ink-900/[0.04]',
};

/**
 * Calendar with drag-and-drop rescheduling.
 *
 * Uses the native HTML drag API rather than a library: it is keyboard-
 * accessible via the per-event menu on every row, works on touch through that
 * same menu, and adds nothing to the bundle.
 */
export function CalendarView({
  from,
  to,
  today,
  events,
}: {
  from: string;
  to: string;
  /** Supplied by the server so the server and client passes agree exactly. */
  today: string;
  events: CalendarEvent[];
}) {
  const router = useRouter();
  const [view, setView] = useState<'month' | 'week' | 'day'>('month');
  const [dragging, setDragging] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => {
    const out: string[] = [];
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    for (let cursor = start; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      out.push(cursor.toISOString().slice(0, 10));
    }
    return out;
  }, [from, to]);

  const visibleDays = view === 'month' ? days.slice(0, 42) : view === 'week' ? days.slice(0, 7) : [today];

  const move = async (eventId: string, date: string) => {
    setPendingId(eventId);
    setError(null);
    const response = await fetch(`/api/v1/me/calendar/${eventId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date }),
    });
    setPendingId(null);
    if (!response.ok) {
      setError('That session could not be moved.');
      return;
    }
    router.refresh();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Tabs
          tabs={[
            { value: 'month', label: 'Month' },
            { value: 'week', label: 'Week' },
            { value: 'day', label: 'Day' },
          ]}
          active={view}
          onChange={(value) => setView(value as 'month' | 'week' | 'day')}
        />
        <p className="text-xs opacity-50">Drag a session onto another day to reschedule it.</p>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-signal-bad">
          <span aria-hidden>!</span> {error}
        </p>
      )}

      {view === 'day' ? (
        <div className="mt-8">
          <DayColumn
            date={today}
            today={today}
            events={events.filter((e) => e.date === today)}
            expanded
            onDrop={move}
            onDragStart={setDragging}
            dragging={dragging}
            pendingId={pendingId}
          />
        </div>
      ) : (
        <div
          className={clsx(
            'mt-8 grid gap-2',
            view === 'month' ? 'grid-cols-2 sm:grid-cols-4 xl:grid-cols-7' : 'grid-cols-1 sm:grid-cols-7',
          )}
        >
          {visibleDays.map((date) => (
            <DayColumn
              key={date}
              date={date}
              today={today}
              events={events.filter((e) => e.date === date)}
              expanded={view === 'week'}
              onDrop={move}
              onDragStart={setDragging}
              dragging={dragging}
              pendingId={pendingId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DayColumn({
  date, today, events, expanded, onDrop, onDragStart, dragging, pendingId,
}: {
  date: string;
  today: string;
  events: CalendarEvent[];
  expanded: boolean;
  onDrop: (id: string, date: string) => void;
  onDragStart: (id: string | null) => void;
  dragging: string | null;
  pendingId: string | null;
}) {
  const [over, setOver] = useState(false);
  const isToday = date === today;

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (dragging) onDrop(dragging, date);
        onDragStart(null);
      }}
      className={clsx(
        'rounded-card border p-3 transition-colors',
        over ? 'border-ember bg-ember/[0.06]' : 'border-ink-900/10 bg-bone-100',
        expanded ? 'min-h-[220px]' : 'min-h-[120px]',
      )}
    >
      <p className={clsx('text-xs font-semibold', isToday ? 'text-ember' : 'opacity-55')}>
        {formatDateLabel(date)}
      </p>

      <ul className="mt-3 space-y-2">
        {events.map((event) => (
          <li key={event.id}>
            <div
              draggable
              onDragStart={() => onDragStart(event.id)}
              onDragEnd={() => onDragStart(null)}
              className={clsx(
                'cursor-grab rounded-[8px] border p-2.5 text-xs transition-opacity active:cursor-grabbing',
                KIND_TONE[event.kind] ?? KIND_TONE.meal,
                pendingId === event.id && 'opacity-50',
                event.status === 'completed' && 'opacity-55',
              )}
            >
              <p className="font-medium leading-snug">{event.title}</p>
              <p className="mt-1 tabular-nums opacity-70">
                {String(Math.floor(event.startMinutes / 60)).padStart(2, '0')}:
                {String(event.startMinutes % 60).padStart(2, '0')} · {event.durationMinutes}m
              </p>
              {event.status === 'completed' && (
                <span className="mt-1.5 inline-block text-[0.625rem] uppercase tracking-[0.1em]">
                  <span aria-hidden>✓</span> Done
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
