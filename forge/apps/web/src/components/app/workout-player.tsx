'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { Button, Card, Chip } from '@/components/ui/primitives';
import { ProgressBar } from '@/components/ui/charts';
import { ErrorState } from '@/components/ui/feedback';
import { generateImage } from '@/lib/imagery';
import { formatLoad, formatSeconds, formatVolume, formatMinutes } from '@/lib/format';
import type { BuiltSession, PlanDay, SessionExercise } from '@/lib/types';

/**
 * The workout player.
 *
 * Everything a member needs mid-set and nothing else: the movement, the target,
 * what they lifted last time, and one control that logs the set and starts the
 * rest timer. Logged sets live in local state until the session is submitted in
 * a single request, so a dropped connection between set three and set four
 * never costs somebody their session.
 */

interface LoggedSet {
  exerciseId: string;
  exerciseName: string;
  setIndex: number;
  reps: number;
  loadGrams: number;
  rpe: number;
  completed: boolean;
  restSeconds: number;
}

interface CompletionSummary {
  summary: {
    durationSeconds: number; volumeGrams: number; calories: number;
    setsCompleted: number; exercises: number; averageRpe: number | null;
  };
  personalRecords: { exerciseName: string; kind: string; value: number; previousValue: number; reps: number }[];
  progression: { exerciseId: string; action: string; reason: string }[];
}

export function WorkoutPlayer({ day, session }: { day: PlanDay; session: BuiltSession }) {
  const router = useRouter();
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [setIndex, setSetIndex] = useState(1);
  const [logged, setLogged] = useState<LoggedSet[]>([]);
  const [rest, setRest] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showTechnique, setShowTechnique] = useState(false);
  const [showSubstitutes, setShowSubstitutes] = useState(false);
  const [phase, setPhase] = useState<'training' | 'feedback' | 'done'>('training');
  const [feedback, setFeedback] = useState<'too-easy' | 'perfect' | 'too-hard' | null>(null);
  const [result, setResult] = useState<CompletionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const exercise = session.exercises[exerciseIndex];
  const startedAt = useRef(Date.now());

  // Session clock. Pausing stops the clock so a member who takes a phone call
  // does not end up with a 90-minute "45-minute session" in their history.
  useEffect(() => {
    if (paused || phase !== 'training') return undefined;
    const timer = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, [paused, phase]);

  useEffect(() => {
    if (rest === null) return undefined;
    if (rest <= 0) {
      setRest(null);
      return undefined;
    }
    const timer = setTimeout(() => setRest((v) => (v === null ? null : v - 1)), 1000);
    return () => clearTimeout(timer);
  }, [rest]);

  const [reps, setReps] = useState(exercise?.prescription.repsTop ?? exercise?.prescription.reps ?? 8);
  const [load, setLoad] = useState(exercise?.prescription.loadGrams ?? 0);
  const [rpe, setRpe] = useState(exercise?.prescription.rpe ?? 8);

  useEffect(() => {
    const current = session.exercises[exerciseIndex];
    if (!current) return;
    setReps(current.prescription.repsTop ?? current.prescription.reps);
    setLoad(current.prescription.loadGrams);
    setRpe(current.prescription.rpe ?? 8);
    setSetIndex(1);
  }, [exerciseIndex, session.exercises]);

  const totalSets = useMemo(
    () => session.exercises.reduce((total, e) => total + e.prescription.sets, 0),
    [session.exercises],
  );

  const logSet = useCallback(() => {
    if (!exercise) return;
    setLogged((current) => [
      ...current.filter((s) => !(s.exerciseId === exercise.exerciseId && s.setIndex === setIndex)),
      {
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.name,
        setIndex,
        reps,
        loadGrams: load,
        rpe,
        completed: true,
        restSeconds: exercise.prescription.restSeconds,
      },
    ]);

    if (setIndex < exercise.prescription.sets) {
      setSetIndex(setIndex + 1);
      setRest(exercise.prescription.restSeconds);
    } else if (exerciseIndex < session.exercises.length - 1) {
      setExerciseIndex(exerciseIndex + 1);
      setRest(exercise.prescription.restSeconds);
    } else {
      setPhase('feedback');
    }
  }, [exercise, setIndex, reps, load, rpe, exerciseIndex, session.exercises.length]);

  const finish = async (chosen: 'too-easy' | 'perfect' | 'too-hard') => {
    setFeedback(chosen);
    setPending(true);
    setError(null);

    const response = await fetch('/api/v1/me/workouts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        planDayId: day.id,
        durationSeconds: Math.max(60, Math.round((Date.now() - startedAt.current) / 1000)),
        difficultyFeedback: chosen,
        sets: logged,
      }),
    });

    setPending(false);
    if (!response.ok) {
      const payload = (await response.json()) as { error?: { message?: string } };
      setError(payload.error?.message ?? 'We could not save this session.');
      return;
    }
    setResult((await response.json()) as CompletionSummary);
    setPhase('done');
    router.refresh();
  };

  if (phase === 'done' && result) {
    return <WorkoutComplete day={day} result={result} feedback={feedback} />;
  }

  if (phase === 'feedback') {
    return (
      <div className="dark-surface min-h-dvh bg-ink-900 px-5 py-16 text-bone-200">
        <div className="mx-auto max-w-lg">
          <p className="eyebrow mb-4">Almost done</p>
          <h1 className="display text-display-md">HOW DIFFICULT WAS TODAY&rsquo;S WORKOUT?</h1>
          <p className="mt-4 text-sm text-bone-200/60">
            This adjusts the next session of the same kind by up to five percent. It is the fastest way to keep
            the plan honest.
          </p>

          {error && (
            <div className="mt-8"><ErrorState title="Session not saved" body={error} /></div>
          )}

          <div className="mt-10 space-y-3">
            {([
              ['too-easy', 'Too Easy', 'I had several reps left on every set.'],
              ['perfect', 'Perfect', 'Hard, but I finished every prescribed rep.'],
              ['too-hard', 'Too Hard', 'I missed reps or had to cut the session short.'],
            ] as const).map(([value, label, description]) => (
              <button
                key={value}
                type="button"
                disabled={pending}
                onClick={() => void finish(value)}
                className={clsx(
                  'w-full rounded-card border p-5 text-left transition-all duration-200 disabled:opacity-50',
                  feedback === value
                    ? 'border-ember bg-ember/[0.08]'
                    : 'border-bone-200/15 bg-ink-800 hover:border-bone-200/40',
                )}
              >
                <p className="font-semibold text-bone-100">{label}</p>
                <p className="mt-1 text-sm text-bone-200/55">{description}</p>
              </button>
            ))}
          </div>

          {pending && <p className="mt-6 text-center text-sm text-bone-200/55">Saving your session…</p>}
        </div>
      </div>
    );
  }

  if (!exercise) return null;

  const completedSets = logged.length;
  const previous = exercise.previous;
  const backdrop = generateImage(`exercise-${exercise.exerciseId}`);

  return (
    <div className="dark-surface flex min-h-dvh flex-col bg-ink-900 text-bone-200">
      {/* ------------------------------------------------------- top bar */}
      <header className="flex items-center justify-between gap-4 border-b border-bone-200/10 px-5 py-4">
        <Link href="/app/plan" className="text-xs uppercase tracking-[0.12em] text-bone-200/50 hover:text-bone-100">
          ← Exit
        </Link>
        <div className="flex-1 px-4">
          <ProgressBar value={completedSets} max={totalSets} tone="accent" />
        </div>
        <span className="text-xs tabular-nums text-bone-200/60">{formatSeconds(elapsed)}</span>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        {/* ----------------------------------------------------- stage */}
        <div className="relative isolate flex min-h-[42vh] flex-1 flex-col justify-end overflow-hidden p-6 sm:p-10">
          <div aria-hidden className="grain absolute inset-0 -z-10" style={{ background: backdrop.background }} />
          <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-ink-900 via-ink-900/60 to-ink-900/20" />

          {rest !== null && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-ink-900/85 backdrop-blur-sm">
              <div className="text-center">
                <p className="eyebrow mb-4">Rest</p>
                <p className="display text-display-lg tabular-nums text-bone-100">{formatSeconds(rest)}</p>
                <div className="mt-8 flex justify-center gap-3">
                  <Button variant="inverse" onClick={() => setRest(null)}>Skip Rest</Button>
                  <Button variant="ghost" onClick={() => setRest(rest + 30)}>+30s</Button>
                </div>
              </div>
            </div>
          )}

          <div>
            <p className="eyebrow mb-3">
              Exercise {exercise.order} of {session.exercises.length} · {exercise.pattern.replace(/-/g, ' ')}
            </p>
            <h1 className="display text-display-md leading-none text-bone-100">{exercise.name.toUpperCase()}</h1>

            <div className="mt-6 flex flex-wrap gap-x-8 gap-y-4">
              <Metric label="Set" value={`${setIndex} / ${exercise.prescription.sets}`} />
              <Metric label="Reps" value={String(exercise.prescription.repsTop ?? exercise.prescription.reps)} />
              <Metric label="Target" value={formatLoad(exercise.prescription.loadGrams)} />
              <Metric
                label="Previous"
                value={previous ? `${formatLoad(previous.loadGrams)} × ${previous.reps ?? '—'}` : 'First time'}
              />
              <Metric label="RPE" value={String(exercise.prescription.rpe ?? 8)} />
            </div>

            <div className="mt-8 flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPaused((v) => !v)}>
                {paused ? 'Resume' : 'Pause'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExerciseIndex(Math.max(0, exerciseIndex - 1))}
                disabled={exerciseIndex === 0}
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExerciseIndex(Math.min(session.exercises.length - 1, exerciseIndex + 1))}
                disabled={exerciseIndex === session.exercises.length - 1}
              >
                Next
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowTechnique((v) => !v)}>Technique</Button>
              <Button variant="ghost" size="sm" onClick={() => setShowSubstitutes((v) => !v)}>
                Substitute
              </Button>
            </div>

            {showTechnique && (
              <div className="mt-6 max-w-lg rounded-card border border-bone-200/12 bg-ink-800/90 p-5">
                <p className="eyebrow mb-2">Coach tip</p>
                <p className="text-sm leading-relaxed text-bone-200/80">&ldquo;{exercise.cue}&rdquo;</p>
                {exercise.prescription.tempo && (
                  <p className="mt-3 text-xs text-bone-200/50">
                    Tempo {exercise.prescription.tempo} · Rest {exercise.prescription.restSeconds}s
                  </p>
                )}
              </div>
            )}

            {showSubstitutes && (
              <div className="mt-6 max-w-lg rounded-card border border-bone-200/12 bg-ink-800/90 p-5">
                <p className="eyebrow mb-3">Substitute exercise</p>
                {exercise.substitutes.length === 0 ? (
                  <p className="text-sm text-bone-200/70">
                    No substitute trains this pattern with the equipment on your profile.
                  </p>
                ) : (
                  <SubstituteList dayId={day.id} exercise={exercise} />
                )}
              </div>
            )}
          </div>
        </div>

        {/* ----------------------------------------------------- logging */}
        <aside className="w-full shrink-0 border-t border-bone-200/10 bg-ink-800 p-6 lg:w-[380px] lg:border-l lg:border-t-0">
          <p className="eyebrow mb-5">Log set {setIndex}</p>

          <div className="space-y-6">
            <Stepper
              label="Weight"
              value={formatLoad(load)}
              onDecrement={() => setLoad(Math.max(0, load - 2500))}
              onIncrement={() => setLoad(load + 2500)}
            />
            <Stepper
              label="Reps"
              value={String(reps)}
              onDecrement={() => setReps(Math.max(1, reps - 1))}
              onIncrement={() => setReps(reps + 1)}
            />
            <div>
              <div className="mb-3 flex items-baseline justify-between">
                <span className="text-xs font-semibold uppercase tracking-[0.1em] text-bone-200/70">RPE</span>
                <span className="text-sm tabular-nums text-bone-100">{rpe}</span>
              </div>
              <input
                type="range"
                min={5}
                max={10}
                step={0.5}
                value={rpe}
                onChange={(event) => setRpe(Number(event.target.value))}
                aria-label="Rate of perceived exertion"
                className="w-full accent-[#E8462B]"
              />
              <div className="mt-1 flex justify-between text-[0.625rem] text-bone-200/40">
                <span>5 · easy</span>
                <span>10 · maximal</span>
              </div>
            </div>
          </div>

          <div className="mt-8">
            <Button size="lg" block onClick={logSet}>Log Set &amp; Rest</Button>
          </div>

          <div className="mt-8">
            <p className="eyebrow mb-3">Session</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <SmallStat label="Sets" value={String(completedSets)} />
              <SmallStat label="Volume" value={formatVolume(logged.reduce((t, s) => t + s.reps * s.loadGrams, 0))} />
              <SmallStat label="Time" value={formatSeconds(elapsed)} />
            </div>
          </div>

          {logged.length > 0 && (
            <div className="mt-8">
              <p className="eyebrow mb-3">Logged</p>
              <ul className="max-h-48 space-y-2 overflow-y-auto text-xs">
                {logged.map((set) => (
                  <li key={`${set.exerciseId}-${set.setIndex}`} className="flex justify-between gap-3 text-bone-200/60">
                    <span className="truncate">{set.exerciseName} · set {set.setIndex}</span>
                    <span className="shrink-0 tabular-nums">
                      {set.reps} × {formatLoad(set.loadGrams)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-8">
            <Button variant="ghost" block onClick={() => setPhase('feedback')}>
              Finish Session Early
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SubstituteList({ dayId, exercise }: { dayId: string; exercise: SessionExercise }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const swap = async (replacementId: string) => {
    setPending(true);
    await fetch(`/api/v1/me/plan/days/${dayId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'substitute', exerciseId: exercise.exerciseId, replacementId }),
    });
    setPending(false);
    router.refresh();
  };

  return (
    <ul className="space-y-2">
      {exercise.substitutes.map((substitute) => (
        <li key={substitute.id}>
          <button
            type="button"
            disabled={pending}
            onClick={() => void swap(substitute.id)}
            className="w-full rounded-[8px] border border-bone-200/15 px-4 py-3 text-left text-sm text-bone-200/80 transition-colors hover:border-bone-200/40 hover:text-bone-100 disabled:opacity-50"
          >
            {substitute.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

function WorkoutComplete({
  day, result, feedback,
}: { day: PlanDay; result: CompletionSummary; feedback: string | null }) {
  return (
    <div className="dark-surface min-h-dvh bg-ink-900 px-5 py-16 text-bone-200">
      <div className="mx-auto max-w-3xl animate-fade-up">
        <div className="flex justify-center">
          <span aria-hidden className="relative grid h-20 w-20 place-items-center rounded-full bg-ember text-2xl">
            ✓
            <span className="absolute inset-0 animate-pulse-ring rounded-full border-2 border-ember" />
          </span>
        </div>

        <h1 className="display mt-8 text-center text-display-md">WORKOUT COMPLETE</h1>
        <p className="mt-3 text-center text-bone-200/60">{day.title}</p>

        <dl className="mt-12 grid grid-cols-2 gap-6 sm:grid-cols-3">
          <BigStat label="Duration" value={formatMinutes(Math.round(result.summary.durationSeconds / 60))} />
          <BigStat label="Volume" value={formatVolume(result.summary.volumeGrams)} />
          <BigStat label="Calories" value={String(result.summary.calories)} />
          <BigStat label="Sets" value={String(result.summary.setsCompleted)} />
          <BigStat label="Exercises" value={String(result.summary.exercises)} />
          <BigStat label="Avg RPE" value={result.summary.averageRpe ? String(result.summary.averageRpe) : '—'} />
        </dl>

        {result.personalRecords.length > 0 && (
          <Card tone="dark">
            <div className="mt-12">
              <p className="eyebrow mb-5 text-ember">
                {result.personalRecords.length} personal record{result.personalRecords.length === 1 ? '' : 's'}
              </p>
              <ul className="space-y-4">
                {result.personalRecords.map((record, index) => (
                  <li key={index} className="flex items-baseline justify-between gap-4 border-b border-bone-200/10 pb-4 last:border-0">
                    <div>
                      <p className="font-semibold text-bone-100">{record.exerciseName}</p>
                      <p className="mt-0.5 text-xs text-bone-200/50">
                        {record.kind === 'load' ? 'Heaviest load' : 'Estimated one-rep max'} · {record.reps} reps
                      </p>
                    </div>
                    <p className="shrink-0 text-right">
                      <span className="display text-lg tabular-nums">{formatLoad(record.value)}</span>
                      {record.previousValue > 0 && (
                        <span className="block text-xs text-bone-200/45">
                          was {formatLoad(record.previousValue)}
                        </span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        )}

        {result.progression.length > 0 && (
          <div className="mt-10">
            <p className="eyebrow mb-4">What changes next session</p>
            <ul className="space-y-3">
              {result.progression.slice(0, 5).map((entry) => (
                <li key={entry.exerciseId} className="rounded-card border border-bone-200/10 bg-ink-800 p-4">
                  <div className="flex items-center gap-3">
                    <Chip tone={entry.action === 'deload' ? 'warn' : 'accent'} size="sm">
                      {entry.action.replace(/-/g, ' ')}
                    </Chip>
                    <span className="text-sm capitalize text-bone-100">
                      {entry.exerciseId.replace(/-/g, ' ')}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-bone-200/60">{entry.reason}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {feedback && (
          <p className="mt-8 text-center text-xs text-bone-200/45">
            You rated this session &ldquo;{feedback.replace(/-/g, ' ')}&rdquo; — the next one of the same kind
            is adjusted accordingly.
          </p>
        )}

        <div className="mt-12 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/app"
            className="flex min-h-[52px] items-center justify-center rounded-[10px] bg-ember px-8 text-xs font-semibold uppercase tracking-[0.1em] text-bone-100"
          >
            Back to Home
          </Link>
          <Link
            href="/app/progress"
            className="flex min-h-[52px] items-center justify-center rounded-[10px] border border-bone-200/25 px-8 text-xs font-semibold uppercase tracking-[0.1em] text-bone-100"
          >
            See Progress
          </Link>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.625rem] uppercase tracking-[0.12em] text-bone-200/45">{label}</p>
      <p className="display mt-1 text-xl leading-none tabular-nums text-bone-100">{value}</p>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-bone-200/10 py-3">
      <p className="display text-sm tabular-nums text-bone-100">{value}</p>
      <p className="mt-1 text-[0.625rem] uppercase tracking-[0.1em] text-bone-200/40">{label}</p>
    </div>
  );
}

function BigStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <dd className="display text-display-sm tabular-nums text-bone-100">{value}</dd>
      <dt className="mt-2 text-[0.625rem] uppercase tracking-[0.12em] text-bone-200/45">{label}</dt>
    </div>
  );
}

function Stepper({
  label, value, onDecrement, onIncrement,
}: { label: string; value: string; onDecrement: () => void; onIncrement: () => void }) {
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-bone-200/70">{label}</p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onDecrement}
          aria-label={`Decrease ${label.toLowerCase()}`}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-[8px] border border-bone-200/20 text-lg text-bone-100 transition-colors hover:border-bone-200/50"
        >
          −
        </button>
        <span className="display flex-1 text-center text-2xl tabular-nums text-bone-100">{value}</span>
        <button
          type="button"
          onClick={onIncrement}
          aria-label={`Increase ${label.toLowerCase()}`}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-[8px] border border-bone-200/20 text-lg text-bone-100 transition-colors hover:border-bone-200/50"
        >
          +
        </button>
      </div>
    </div>
  );
}
