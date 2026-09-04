'use client';

import { useMemo, useState } from 'react';
import { CoachCard as CoachCardView } from '@/components/marketing/cards';
import { FilterChips } from '@/components/ui/forms';
import { EmptyState } from '@/components/ui/feedback';
import { Button } from '@/components/ui/primitives';
import { formatCents } from '@/lib/format';
import type { CoachCard } from '@/lib/types';

const GOALS = [
  { value: 'build-muscle', label: 'Build Muscle' },
  { value: 'lose-body-fat', label: 'Lose Body Fat' },
  { value: 'improve-strength', label: 'Improve Strength' },
  { value: 'improve-endurance', label: 'Improve Endurance' },
  { value: 'improve-mobility', label: 'Improve Mobility' },
  { value: 'train-for-competition', label: 'Competition' },
];

const GOAL_SPECIALTY: Record<string, string[]> = {
  'build-muscle': ['hypertrophy', 'strength'],
  'lose-body-fat': ['fat-loss', 'nutrition'],
  'improve-strength': ['strength', 'sport-performance'],
  'improve-endurance': ['endurance'],
  'improve-mobility': ['mobility'],
  'train-for-competition': ['sport-performance', 'strength'],
};

export function CoachMarketplace({ coaches }: { coaches: CoachCard[] }) {
  const [goals, setGoals] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [availability, setAvailability] = useState<string[]>([]);
  const [price, setPrice] = useState<string[]>([]);
  const [experience, setExperience] = useState<string[]>([]);

  const allLanguages = useMemo(
    () => [...new Set(coaches.flatMap((coach) => coach.languages))].sort(),
    [coaches],
  );

  const results = useMemo(() => {
    const wanted = new Set(goals.flatMap((goal) => GOAL_SPECIALTY[goal] ?? []));
    const maxPrice = price.length > 0 ? Math.min(...price.map(Number)) : null;
    const minYears = experience.length > 0 ? Math.max(...experience.map(Number)) : null;

    return coaches
      .filter((coach) => {
        if (wanted.size > 0 && !coach.specialties.some((s) => wanted.has(s))) return false;
        if (languages.length > 0 && !languages.some((l) => coach.languages.includes(l))) return false;
        if (availability.includes('this-week') && coach.availableSlotsThisWeek <= 0) return false;
        if (maxPrice !== null && coach.monthlyPriceCents > maxPrice) return false;
        if (minYears !== null && coach.yearsExperience < minYears) return false;
        return true;
      })
      .map((coach) => {
        // The reasons render on the card, so the ranking is never a black box.
        const reasons: string[] = [];
        const overlap = coach.specialties.filter((s) => wanted.has(s));
        if (overlap.length > 0) {
          reasons.push(`Specialises in ${overlap.map((s) => s.replace(/-/g, ' ')).join(' and ')}`);
        }
        if (coach.availableSlotsThisWeek > 0) reasons.push(`${coach.availableSlotsThisWeek} slots open this week`);
        return { ...coach, matchReasons: reasons };
      })
      .sort((a, b) => (b.matchReasons?.length ?? 0) - (a.matchReasons?.length ?? 0) || b.ratingTenths - a.ratingTenths);
  }, [coaches, goals, languages, availability, price, experience]);

  const activeCount = goals.length + languages.length + availability.length + price.length + experience.length;
  const clear = () => {
    setGoals([]); setLanguages([]); setAvailability([]); setPrice([]); setExperience([]);
  };

  return (
    <div className="grid gap-10 lg:grid-cols-[280px_1fr] lg:gap-14">
      <aside className="space-y-7 lg:sticky lg:top-28 lg:self-start">
        <FilterChips label="Goal" options={GOALS} selected={goals} onChange={setGoals} multi />
        <FilterChips
          label="Language"
          options={allLanguages.map((l) => ({ value: l, label: l }))}
          selected={languages}
          onChange={setLanguages}
          multi
        />
        <FilterChips
          label="Availability"
          options={[{ value: 'this-week', label: 'Available this week' }]}
          selected={availability}
          onChange={setAvailability}
        />
        <FilterChips
          label="Price"
          options={[
            { value: '15000', label: `Under ${formatCents(15000)}` },
            { value: '17000', label: `Under ${formatCents(17000)}` },
            { value: '20000', label: `Under ${formatCents(20000)}` },
          ]}
          selected={price}
          onChange={setPrice}
        />
        <FilterChips
          label="Experience"
          options={[
            { value: '5', label: '5+ years' },
            { value: '8', label: '8+ years' },
            { value: '10', label: '10+ years' },
          ]}
          selected={experience}
          onChange={setExperience}
        />
        {activeCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clear} block>
            Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
          </Button>
        )}
      </aside>

      <div>
        <p className="mb-8 text-sm opacity-60">
          <span className="font-semibold text-ink-900">{results.length}</span> coach
          {results.length === 1 ? '' : 'es'} available
        </p>

        {results.length === 0 ? (
          <EmptyState
            icon="⌕"
            title="No coach matches every filter"
            body="Widening the price or availability filter usually opens things up — most coaches take new clients within a fortnight."
            action={<Button variant="secondary" onClick={clear}>Clear filters</Button>}
          />
        ) : (
          <div className="grid gap-5 xl:grid-cols-2">
            {results.map((coach) => (
              <CoachCardView key={coach.slug} coach={coach} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
