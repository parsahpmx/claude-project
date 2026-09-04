'use client';

import { useMemo, useState } from 'react';
import { ProgramCard } from '@/components/marketing/cards';
import { FilterChips, SearchInput } from '@/components/ui/forms';
import { EmptyState } from '@/components/ui/feedback';
import { Button } from '@/components/ui/primitives';
import type { Program } from '@/lib/types';

/**
 * Programme discovery.
 *
 * Filtering happens on the client over a list the server already sent. The
 * catalogue is twelve items; a round trip per keystroke would be slower and
 * would make the filters feel broken on a train.
 */
export function ProgramFilters({
  programs,
  facets,
}: {
  programs: Program[];
  facets: {
    goals: { value: string; label: string }[];
    styles: { value: string; label: string }[];
    equipment: { value: string; label: string }[];
    durations: number[];
  };
}) {
  const [search, setSearch] = useState('');
  const [goals, setGoals] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [durations, setDurations] = useState<string[]>([]);

  const results = useMemo(() => {
    const query = search.trim().toLowerCase();
    const maxMinutes = durations.length > 0 ? Math.max(...durations.map(Number)) : null;

    return programs.filter((program) => {
      if (query && !`${program.name} ${program.tagline} ${program.summary}`.toLowerCase().includes(query)) return false;
      if (goals.length > 0 && !goals.some((goal) => program.goals.includes(goal))) return false;
      if (styles.length > 0 && !styles.some((style) => program.styles.includes(style))) return false;
      if (levels.length > 0 && !levels.includes(program.difficulty)) return false;
      // Equipment is a capability check, not a tag match: a programme shows if
      // everything it needs is in the member's selection.
      if (equipment.length > 0 && !program.equipment.every((item) => equipment.includes(item))) return false;
      if (maxMinutes !== null && program.sessionMinutes > maxMinutes) return false;
      return true;
    });
  }, [programs, search, goals, styles, levels, equipment, durations]);

  const activeCount = goals.length + styles.length + levels.length + equipment.length + durations.length;

  const clear = () => {
    setSearch('');
    setGoals([]);
    setStyles([]);
    setLevels([]);
    setEquipment([]);
    setDurations([]);
  };

  return (
    <div className="grid gap-10 lg:grid-cols-[280px_1fr] lg:gap-14">
      <aside className="lg:sticky lg:top-28 lg:self-start">
        <div className="space-y-7">
          <SearchInput
            value={search}
            onChange={setSearch}
            label="Search programmes"
            placeholder="What do you want to train?"
          />
          <FilterChips label="Goal" options={facets.goals} selected={goals} onChange={setGoals} multi />
          <FilterChips label="Training style" options={facets.styles} selected={styles} onChange={setStyles} multi />
          <FilterChips
            label="Experience"
            options={[
              { value: 'beginner', label: 'Beginner' },
              { value: 'intermediate', label: 'Intermediate' },
              { value: 'advanced', label: 'Advanced' },
            ]}
            selected={levels}
            onChange={setLevels}
            multi
          />
          <FilterChips
            label="Session length"
            options={facets.durations.map((d) => ({ value: String(d), label: `${d} min or less` }))}
            selected={durations}
            onChange={setDurations}
          />
          <FilterChips label="My equipment" options={facets.equipment} selected={equipment} onChange={setEquipment} multi />

          {activeCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clear} block>
              Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
            </Button>
          )}
        </div>
      </aside>

      <div>
        <div className="mb-8 flex items-baseline justify-between gap-4">
          <p className="text-sm opacity-60">
            <span className="font-semibold text-ink-900">{results.length}</span> programme
            {results.length === 1 ? '' : 's'}
            {activeCount > 0 && ' matching your filters'}
          </p>
        </div>

        {results.length === 0 ? (
          <EmptyState
            icon="⌕"
            title="Nothing matches all of those filters"
            body="Try widening the equipment selection — programmes only appear when you own everything they need."
            action={<Button variant="secondary" onClick={clear}>Clear filters</Button>}
          />
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((program) => (
              <ProgramCard key={program.slug} program={program} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
