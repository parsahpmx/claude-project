'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Button, Card, Chip } from '@/components/ui/primitives';
import { SearchInput, Select } from '@/components/ui/forms';
import { EmptyState } from '@/components/ui/feedback';
import { formatLoad } from '@/lib/format';
import type { Program } from '@/lib/types';

/**
 * Drag-and-drop program builder.
 *
 * A block is seven day columns holding ordered exercise entries, each with the
 * full prescription a coach actually writes: sets, reps, load, RPE, tempo,
 * rest, a note and a video reference. Loading a FORGE template seeds the week
 * so a coach starts from a structure rather than a blank grid.
 */

interface ExerciseOption {
  id: string; name: string; pattern: string; compound: boolean; requires: string[];
}

interface Entry {
  key: string;
  exerciseId: string;
  name: string;
  sets: number;
  reps: number;
  loadGrams: number;
  rpe: number;
  tempo: string;
  restSeconds: number;
  note: string;
  videoKey: string;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function ProgramBuilder({
  templates,
  exercises,
}: {
  templates: Program[];
  exercises: ExerciseOption[];
}) {
  const [week, setWeek] = useState<Record<string, Entry[]>>(
    Object.fromEntries(DAYS.map((day) => [day, []])),
  );
  const [search, setSearch] = useState('');
  const [pattern, setPattern] = useState('all');
  const [dragging, setDragging] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ day: string; key: string } | null>(null);

  const patterns = useMemo(
    () => ['all', ...new Set(exercises.map((e) => e.pattern))],
    [exercises],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return exercises.filter((exercise) => {
      if (pattern !== 'all' && exercise.pattern !== pattern) return false;
      if (query && !exercise.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [exercises, search, pattern]);

  const addExercise = (day: string, exerciseId: string) => {
    const exercise = exercises.find((e) => e.id === exerciseId);
    if (!exercise) return;
    const entry: Entry = {
      key: `${exerciseId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      exerciseId,
      name: exercise.name,
      sets: exercise.compound ? 4 : 3,
      reps: exercise.compound ? 6 : 10,
      loadGrams: exercise.compound ? 60_000 : 20_000,
      rpe: 8,
      tempo: exercise.compound ? '3010' : '2011',
      restSeconds: exercise.compound ? 180 : 75,
      note: '',
      videoKey: '',
    };
    setWeek((current) => ({ ...current, [day]: [...(current[day] ?? []), entry] }));
    setSelected({ day, key: entry.key });
  };

  const removeEntry = (day: string, key: string) => {
    setWeek((current) => ({ ...current, [day]: (current[day] ?? []).filter((e) => e.key !== key) }));
    if (selected?.key === key) setSelected(null);
  };

  const updateEntry = (day: string, key: string, patch: Partial<Entry>) => {
    setWeek((current) => ({
      ...current,
      [day]: (current[day] ?? []).map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)),
    }));
  };

  const loadTemplate = (slug: string) => {
    const template = templates.find((t) => t.slug === slug);
    if (!template) return;

    const next: Record<string, Entry[]> = Object.fromEntries(DAYS.map((day) => [day, []]));
    for (const session of template.template) {
      const day = DAYS[Math.min(6, session.day - 1)]!;
      for (const movementPattern of session.patterns) {
        const match = exercises.find((e) => e.pattern === movementPattern);
        if (!match) continue;
        next[day] = [
          ...(next[day] ?? []),
          {
            key: `${match.id}-${day}-${movementPattern}`,
            exerciseId: match.id,
            name: match.name,
            sets: match.compound ? 4 : 3,
            reps: match.compound ? 6 : 10,
            loadGrams: match.compound ? 60_000 : 20_000,
            rpe: 8,
            tempo: match.compound ? '3010' : '2011',
            restSeconds: match.compound ? 180 : 75,
            note: '',
            videoKey: '',
          },
        ];
      }
    }
    setWeek(next);
    setSelected(null);
  };

  const totalEntries = Object.values(week).reduce((total, entries) => total + entries.length, 0);
  const active = selected ? week[selected.day]?.find((e) => e.key === selected.key) ?? null : null;

  return (
    <div className="grid gap-6 xl:grid-cols-[260px_1fr_300px]">
      {/* ------------------------------------------------- exercise library */}
      <aside aria-label="Templates" className="space-y-4">
        <Card>
          <h2 className="eyebrow mb-4">Start from a template</h2>
          <Select
            label="FORGE programme"
            options={[{ value: '', label: 'Blank week' }, ...templates.map((t) => ({ value: t.slug, label: t.name }))]}
            onChange={(event) => loadTemplate(event.target.value)}
          />
        </Card>

        <Card padded={false}>
          <div className="space-y-4 p-5">
            <p className="eyebrow">Movement library</p>
            <SearchInput value={search} onChange={setSearch} label="Search exercises" placeholder="Search" />
            <Select
              label="Pattern"
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              options={patterns.map((p) => ({ value: p, label: p === 'all' ? 'All patterns' : p.replace(/-/g, ' ') }))}
            />
          </div>

          <ul className="max-h-[420px] overflow-y-auto border-t border-ink-900/10" tabIndex={0} aria-label="Movement library">
            {filtered.map((exercise) => (
              <li key={exercise.id}>
                <div
                  draggable
                  onDragStart={() => setDragging(exercise.id)}
                  onDragEnd={() => setDragging(null)}
                  className="cursor-grab border-b border-ink-900/6 px-5 py-3 text-sm transition-colors hover:bg-ink-900/[0.03] active:cursor-grabbing"
                >
                  <p className="font-medium">{exercise.name}</p>
                  <p className="mt-0.5 text-[0.6875rem] capitalize text-muted">
                    {exercise.pattern.replace(/-/g, ' ')}
                    {exercise.compound ? ' · compound' : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </aside>

      {/* ------------------------------------------------------- the week */}
      <div>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            <span className="font-semibold text-ink-900">{totalEntries}</span> exercises across the week
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setWeek(Object.fromEntries(DAYS.map((day) => [day, []])))}
            >
              Clear week
            </Button>
            <Button size="sm" disabled={totalEntries === 0}>Save Program</Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {DAYS.map((day) => (
            <DayColumn
              key={day}
              day={day}
              entries={week[day] ?? []}
              onDrop={(exerciseId) => addExercise(day, exerciseId)}
              onSelect={(key) => setSelected({ day, key })}
              onRemove={(key) => removeEntry(day, key)}
              dragging={dragging}
              selectedKey={selected?.day === day ? selected.key : null}
            />
          ))}
        </div>
      </div>

      {/* -------------------------------------------------- prescription */}
      <aside aria-label="Prescription">
        <Card>
          <h2 className="eyebrow mb-5">Prescription</h2>
          {!active || !selected ? (
            <EmptyState
              icon="▦"
              title="Nothing selected"
              body="Drag a movement onto a day, then select it to set sets, reps, load, RPE, tempo and rest."
            />
          ) : (
            <div className="space-y-5">
              <div>
                <p className="font-semibold">{active.name}</p>
                <p className="mt-0.5 text-xs text-muted">{selected.day}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <NumberField
                  label="Sets" value={active.sets} min={1} max={10}
                  onChange={(v) => updateEntry(selected.day, active.key, { sets: v })}
                />
                <NumberField
                  label="Reps" value={active.reps} min={1} max={50}
                  onChange={(v) => updateEntry(selected.day, active.key, { reps: v })}
                />
                <NumberField
                  label="Load (kg)" value={Math.round(active.loadGrams / 1000)} min={0} max={400}
                  onChange={(v) => updateEntry(selected.day, active.key, { loadGrams: v * 1000 })}
                />
                <NumberField
                  label="RPE" value={active.rpe} min={5} max={10}
                  onChange={(v) => updateEntry(selected.day, active.key, { rpe: v })}
                />
                <NumberField
                  label="Rest (s)" value={active.restSeconds} min={0} max={600} step={15}
                  onChange={(v) => updateEntry(selected.day, active.key, { restSeconds: v })}
                />
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.1em] opacity-70">
                    Tempo
                  </label>
                  <input
                    value={active.tempo}
                    onChange={(event) => updateEntry(selected.day, active.key, { tempo: event.target.value })}
                    className="min-h-[44px] w-full rounded-[8px] border border-ink-900/15 px-3 text-sm focus:border-ember"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.1em] opacity-70">
                  Coach note
                </label>
                <textarea
                  value={active.note}
                  onChange={(event) => updateEntry(selected.day, active.key, { note: event.target.value })}
                  rows={3}
                  placeholder="What to focus on, and what to do if it feels wrong."
                  className="w-full rounded-[8px] border border-ink-900/15 p-3 text-sm leading-relaxed focus:border-ember"
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.1em] opacity-70">
                  Video reference
                </label>
                <input
                  value={active.videoKey}
                  onChange={(event) => updateEntry(selected.day, active.key, { videoKey: event.target.value })}
                  placeholder="Demo clip identifier"
                  className="min-h-[44px] w-full rounded-[8px] border border-ink-900/15 px-3 text-sm focus:border-ember"
                />
              </div>

              <div className="rounded-[8px] border border-ink-900/10 bg-ink-900/[0.02] p-4 text-xs">
                <p className="font-semibold">Client sees</p>
                <p className="mt-1.5 text-muted">
                  {active.sets} × {active.reps} @ {formatLoad(active.loadGrams)} · RPE {active.rpe} · tempo{' '}
                  {active.tempo} · {active.restSeconds}s rest
                </p>
              </div>

              <Button variant="ghost" size="sm" block onClick={() => removeEntry(selected.day, active.key)}>
                Remove from week
              </Button>
            </div>
          )}
        </Card>
      </aside>
    </div>
  );
}

function DayColumn({
  day, entries, onDrop, onSelect, onRemove, dragging, selectedKey,
}: {
  day: string;
  entries: Entry[];
  onDrop: (exerciseId: string) => void;
  onSelect: (key: string) => void;
  onRemove: (key: string) => void;
  dragging: string | null;
  selectedKey: string | null;
}) {
  const [over, setOver] = useState(false);

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
        if (dragging) onDrop(dragging);
      }}
      className={clsx(
        'min-h-[180px] rounded-card border p-3 transition-colors',
        over ? 'accent-tint border-ember bg-ember/[0.06]' : 'light-surface border-ink-900/10 bg-bone-100',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">{day.slice(0, 3)}</p>
        {entries.length > 0 && <Chip size="sm">{entries.length}</Chip>}
      </div>

      {entries.length === 0 ? (
        <p className="mt-6 text-center text-[0.6875rem] text-muted">Drop movements here</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {entries.map((entry, index) => (
            <li key={entry.key}>
              <div
                className={clsx(
                  'rounded-[8px] border p-2.5 text-xs transition-colors',
                  selectedKey === entry.key ? 'accent-tint border-ember bg-ember/[0.07]' : 'border-ink-900/10',
                )}
              >
                <button type="button" onClick={() => onSelect(entry.key)} className="w-full text-left">
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-medium leading-snug">
                      {index + 1}. {entry.name}
                    </span>
                  </span>
                  <span className="mt-1 block tabular-nums text-muted">
                    {entry.sets} × {entry.reps} · RPE {entry.rpe}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(entry.key)}
                  className="mt-2 text-[0.625rem] uppercase tracking-[0.1em] text-status-bad opacity-70 hover:opacity-100"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function NumberField({
  label, value, min, max, step = 1, onChange,
}: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return (
    <div>
      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.1em] opacity-70">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-h-[44px] w-full rounded-[8px] border border-ink-900/15 px-3 text-sm tabular-nums focus:border-ember"
      />
    </div>
  );
}
