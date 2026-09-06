import { ButtonLink, Card } from '@/components/ui/primitives';

export const metadata = { title: 'Build a route' };

/**
 * The route builder is not in this beta.
 *
 * Rather than ship a half-builder that produces routes with wrong distances,
 * the page says what is missing and what to do instead. §84: an empty state
 * names a real next action.
 */
export default function NewRoutePage() {
  return (
    <div className="max-w-xl space-y-7">
      <header>
        <h1 className="text-page-title font-display text-bone-100">Build a route</h1>
        <p className="mt-2 text-body muted">The route builder is not in this beta yet.</p>
      </header>

      <Card>
        <h2 className="text-section text-bone-100">Why it is not here</h2>
        <p className="mt-3 text-secondary muted">
          Drawing a route is easy; snapping it to real paths and getting the distance and climbing
          right is not, and a builder that reports the wrong distance is worse than no builder. It
          needs a routing provider, and picking one is a cost decision we have not made yet — the
          reasoning is in <code className="font-mono">docs/WEB_MAPS.md</code>.
        </p>
        <h2 className="mt-6 text-section text-bone-100">What works today</h2>
        <ul className="mt-3 space-y-2.5">
          {[
            'Your recorded activities are drawn on your personal map',
            'Activities carry distance, climbing, splits and pace',
            'Routes saved from elsewhere display with full detail',
          ].map((item) => (
            <li key={item} className="flex gap-3 text-secondary">
              <span aria-hidden className="text-signal">
                —
              </span>
              <span className="muted">{item}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/maps">Open your map</ButtonLink>
        <ButtonLink href="/activities/new" variant="secondary">
          Record an activity
        </ButtonLink>
      </div>
    </div>
  );
}
