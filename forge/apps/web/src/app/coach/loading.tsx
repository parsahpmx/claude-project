import { Skeleton, SkeletonCard } from '@/components/ui/feedback';

/** Coach workspace loading state. Same reasoning as the member segment. */
export default function CoachLoading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>

      <div>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-4 h-10 w-64 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="light-surface rounded-card border border-ink-900/10 bg-bone-100 p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-4 h-8 w-20" />
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {[0, 1].map((i) => <SkeletonCard key={i} />)}
      </div>
    </div>
  );
}
