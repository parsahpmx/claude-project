'use client';

import { ErrorState } from '@/components/ui/feedback';
import { Button } from '@/components/ui/primitives';

/**
 * Member application error boundary.
 *
 * Without this, a failed API call takes the whole app to Next's default error
 * screen — which tells a member nothing and offers them nothing. Here they get
 * the product's own error state and a way back into their session.
 *
 * The underlying message is deliberately not shown: it comes from the API and
 * may name internals. It is logged to the console for a developer instead.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  if (typeof window !== 'undefined') {
    console.error('Member app error:', error);
  }

  return (
    <div className="mx-auto max-w-xl py-10">
      <ErrorState
        title="We could not load that screen"
        body="Your training data is safe. This is almost always a temporary connection problem — try again, and if it keeps happening the support team can see the details."
        action={
          <div className="flex flex-wrap gap-3">
            <Button onClick={reset}>Try again</Button>
            <Button variant="ghost" onClick={() => { window.location.href = '/app'; }}>
              Back to dashboard
            </Button>
          </div>
        }
      />
    </div>
  );
}
