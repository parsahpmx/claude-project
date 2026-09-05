'use client';

import { useMemo, useState } from 'react';
import { WorkoutCard } from '@/components/marketing/cards';
import { FilterChips, SearchInput } from '@/components/ui/forms';
import { Button } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/feedback';

/**
 * Workout discovery.
 *
 * The catalogue below is representative sample content for the marketing site —
 * a signed-in member sees their own library, filtered by the equipment on their
 * profile. Both use the same card and the same filter controls.
 */

interface Workout {
  id: string;
  title: string;
  style: string;
  minutes: number;
  level: string;
  coach: string;
  format: 'COACHED' | 'SELF-GUIDED';
  bodyFocus: string;
  equipment: string[];
  intensity: 'low' | 'moderate' | 'high';
  imageKey: string;
}

const WORKOUTS: Workout[] = [
  { id: 'w1', title: 'Heavy Lower Body', style: 'strength', minutes: 45, level: 'intermediate', coach: 'Daniel', format: 'COACHED', bodyFocus: 'lower-body', equipment: ['barbell'], intensity: 'high', imageKey: 'workout-lower' },
  { id: 'w2', title: 'Upper Body Push', style: 'strength', minutes: 45, level: 'intermediate', coach: 'Maya', format: 'COACHED', bodyFocus: 'upper-body', equipment: ['dumbbells'], intensity: 'moderate', imageKey: 'workout-push' },
  { id: 'w3', title: '20-Minute Conditioning', style: 'hiit', minutes: 20, level: 'beginner', coach: 'Sofia', format: 'COACHED', bodyFocus: 'full-body', equipment: ['bodyweight'], intensity: 'high', imageKey: 'workout-hiit' },
  { id: 'w4', title: 'Threshold Intervals', style: 'running', minutes: 40, level: 'advanced', coach: 'Amara', format: 'SELF-GUIDED', bodyFocus: 'full-body', equipment: ['bodyweight'], intensity: 'high', imageKey: 'workout-run' },
  { id: 'w5', title: 'Full Body Mobility', style: 'mobility', minutes: 10, level: 'beginner', coach: 'Inés', format: 'COACHED', bodyFocus: 'full-body', equipment: ['bodyweight'], intensity: 'low', imageKey: 'workout-mobility' },
  { id: 'w6', title: 'Kettlebell Complex', style: 'functional', minutes: 30, level: 'intermediate', coach: 'Kenji', format: 'COACHED', bodyFocus: 'full-body', equipment: ['kettlebell'], intensity: 'high', imageKey: 'workout-kettlebell' },
  { id: 'w7', title: 'Pull Strength', style: 'strength', minutes: 45, level: 'intermediate', coach: 'Maya', format: 'COACHED', bodyFocus: 'upper-body', equipment: ['barbell'], intensity: 'moderate', imageKey: 'workout-pull' },
  { id: 'w8', title: 'Slow Flow', style: 'yoga', minutes: 30, level: 'beginner', coach: 'Inés', format: 'COACHED', bodyFocus: 'full-body', equipment: ['bodyweight'], intensity: 'low', imageKey: 'workout-yoga' },
  { id: 'w9', title: 'Boxing Foundations', style: 'boxing', minutes: 30, level: 'beginner', coach: 'Kenji', format: 'COACHED', bodyFocus: 'full-body', equipment: ['bodyweight'], intensity: 'moderate', imageKey: 'workout-boxing' },
  { id: 'w10', title: 'Core Control', style: 'pilates', minutes: 20, level: 'beginner', coach: 'Sofia', format: 'COACHED', bodyFocus: 'core', equipment: ['bodyweight'], intensity: 'low', imageKey: 'workout-pilates' },
  { id: 'w11', title: 'Zone 2 Row', style: 'cardio', minutes: 45, level: 'beginner', coach: 'Amara', format: 'SELF-GUIDED', bodyFocus: 'full-body', equipment: ['cardio-equipment'], intensity: 'low', imageKey: 'workout-row' },
  { id: 'w12', title: 'Post-Session Reset', style: 'recovery', minutes: 15, level: 'beginner', coach: 'Inés', format: 'COACHED', bodyFocus: 'full-body', equipment: ['bodyweight'], intensity: 'low', imageKey: 'workout-reset' },
  { id: 'w13', title: 'Hybrid Engine', style: 'hybrid', minutes: 60, level: 'advanced', coach: 'Kenji', format: 'SELF-GUIDED', bodyFocus: 'full-body', equipment: ['dumbbells', 'cardio-equipment'], intensity: 'high', imageKey: 'workout-hybrid' },
  { id: 'w14', title: 'Five-Minute Desk Reset', style: 'mobility', minutes: 5, level: 'beginner', coach: 'Inés', format: 'COACHED', bodyFocus: 'upper-body', equipment: ['bodyweight'], intensity: 'low', imageKey: 'workout-desk' },
  { id: 'w15', title: 'Glute Focus', style: 'strength', minutes: 30, level: 'beginner', coach: 'Sofia', format: 'COACHED', bodyFocus: 'glutes', equipment: ['dumbbells'], intensity: 'moderate', imageKey: 'workout-glutes' },
];

const STYLES = ['strength', 'hiit', 'running', 'pilates', 'yoga', 'boxing', 'mobility', 'functional', 'hybrid', 'cardio', 'recovery'];
const DURATIONS = [5, 10, 15, 20, 30, 45, 60];
const FOCUS = ['full-body', 'upper-body', 'lower-body', 'core', 'glutes'];
const EQUIPMENT = ['bodyweight', 'dumbbells', 'barbell', 'kettlebell', 'cardio-equipment'];

export function WorkoutDiscovery() {
  const [search, setSearch] = useState('');
  const [styles, setStyles] = useState<string[]>([]);
  const [durations, setDurations] = useState<string[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [focus, setFocus] = useState<string[]>([]);
  const [coaches, setCoaches] = useState<string[]>([]);
  const [intensity, setIntensity] = useState<string[]>([]);
  const [format, setFormat] = useState<string[]>([]);

  const coachOptions = useMemo(
    () => [...new Set(WORKOUTS.map((w) => w.coach))].map((c) => ({ value: c, label: c })),
    [],
  );

  const results = useMemo(() => {
    const query = search.trim().toLowerCase();
    const maxMinutes = durations.length > 0 ? Math.max(...durations.map(Number)) : null;

    return WORKOUTS.filter((workout) => {
      if (query && !workout.title.toLowerCase().includes(query) && !workout.style.includes(query)) return false;
      if (styles.length > 0 && !styles.includes(workout.style)) return false;
      if (maxMinutes !== null && workout.minutes > maxMinutes) return false;
      if (levels.length > 0 && !levels.includes(workout.level)) return false;
      if (equipment.length > 0 && !workout.equipment.every((item) => equipment.includes(item))) return false;
      if (focus.length > 0 && !focus.includes(workout.bodyFocus)) return false;
      if (coaches.length > 0 && !coaches.includes(workout.coach)) return false;
      if (intensity.length > 0 && !intensity.includes(workout.intensity)) return false;
      if (format.length > 0 && !format.includes(workout.format)) return false;
      return true;
    });
  }, [search, styles, durations, levels, equipment, focus, coaches, intensity, format]);

  const activeCount =
    styles.length + durations.length + levels.length + equipment.length +
    focus.length + coaches.length + intensity.length + format.length;

  const clear = () => {
    setSearch(''); setStyles([]); setDurations([]); setLevels([]);
    setEquipment([]); setFocus([]); setCoaches([]); setIntensity([]); setFormat([]);
  };

  return (
    <div className="grid gap-10 lg:grid-cols-[280px_1fr] lg:gap-14">
      <aside aria-label="Workout filters" className="space-y-7 lg:sticky lg:top-28 lg:self-start">
        <SearchInput value={search} onChange={setSearch} label="Search workouts" placeholder="Search workouts" />
        <FilterChips
          label="Workout format"
          options={[{ value: 'COACHED', label: 'Coached' }, { value: 'SELF-GUIDED', label: 'Self-guided' }]}
          selected={format} onChange={setFormat}
        />
        <FilterChips
          label="Training style"
          options={STYLES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
          selected={styles} onChange={setStyles} multi
        />
        <FilterChips
          label="Duration"
          options={DURATIONS.map((d) => ({ value: String(d), label: d === 60 ? '60+ min' : `${d} min` }))}
          selected={durations} onChange={setDurations}
        />
        <FilterChips
          label="Experience"
          options={[
            { value: 'beginner', label: 'Beginner' },
            { value: 'intermediate', label: 'Intermediate' },
            { value: 'advanced', label: 'Advanced' },
          ]}
          selected={levels} onChange={setLevels} multi
        />
        <FilterChips
          label="Equipment"
          options={EQUIPMENT.map((e) => ({ value: e, label: e.replace(/-/g, ' ') }))}
          selected={equipment} onChange={setEquipment} multi
        />
        <FilterChips
          label="Body focus"
          options={FOCUS.map((f) => ({ value: f, label: f.replace(/-/g, ' ') }))}
          selected={focus} onChange={setFocus} multi
        />
        <FilterChips label="Coach" options={coachOptions} selected={coaches} onChange={setCoaches} multi />
        <FilterChips
          label="Intensity"
          options={[
            { value: 'low', label: 'Low' },
            { value: 'moderate', label: 'Moderate' },
            { value: 'high', label: 'High' },
          ]}
          selected={intensity} onChange={setIntensity} multi
        />
        {activeCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clear} block>Clear {activeCount} filters</Button>
        )}
      </aside>

      <div>
        {/* Heading for the results region, as on the programme library. */}
        <h2 className="mb-8 text-sm font-normal text-muted" aria-live="polite">
          <span className="font-semibold text-ink-900">{results.length}</span> workout
          {results.length === 1 ? '' : 's'}
        </h2>

        {results.length === 0 ? (
          <EmptyState
            icon="⌕"
            title="No workouts match every filter"
            body="Equipment is a capability check — a workout only appears when you have everything it needs."
            action={<Button variant="secondary" onClick={clear}>Clear filters</Button>}
          />
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((workout) => (
              <WorkoutCard
                key={workout.id}
                title={workout.title}
                style={workout.style}
                minutes={workout.minutes}
                level={workout.level}
                coach={workout.coach}
                format={workout.format}
                imageKey={workout.imageKey}
                href="/assessment"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
