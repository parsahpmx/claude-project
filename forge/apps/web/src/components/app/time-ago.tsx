'use client';

import { useEffect, useState } from 'react';
import { formatDateLabel, relativeTime } from '@/lib/format';

/**
 * Relative timestamps without a hydration mismatch.
 *
 * "3h ago" computed during render is a different string on the server than in
 * the browser a moment later, which React reports as a hydration error and
 * which loses the surrounding interactivity. This renders a stable absolute
 * date for the server pass and upgrades to relative after mount — so the first
 * paint is always correct and the two passes always agree.
 */
export function TimeAgo({ iso }: { iso: string }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <time dateTime={iso} title={new Date(iso).toUTCString()}>
      {mounted ? relativeTime(iso) : formatDateLabel(iso.slice(0, 10))}
    </time>
  );
}
