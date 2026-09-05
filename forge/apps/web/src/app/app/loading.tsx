import { Skeleton, SkeletonCard } from '@/components/ui/feedback';

/**
 * Member application loading state.
 *
 * Every page under this segment resolves its data on the server, so a
 * navigation shows nothing at all until the API answers. This is what fills
 * that gap. The boxes match the real dashboard's rhythm — an eyebrow, a
 * heading, a row of stats, then cards — so the layout does not jump when the
 * content lands.
 */
export default function AppLoading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>

      <div>
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-4 h-10 w-72 max-w-full" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="light-surface rounded-card border border-ink-900/10 bg-bone-100 p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-4 h-8 w-24" />
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
      </div>
    </div>
  );
}
