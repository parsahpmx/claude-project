'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

/**
 * Primary navigation.
 *
 * Five destinations and one action. Desktop gets a top bar rather than a
 * sidebar — this is a place you read and browse, not an admin console, and a
 * 248px rail would take width away from the map, which is the one screen that
 * genuinely needs it. Mobile gets a bottom bar, thumb-reachable.
 */
const NAV = [
  { href: '/home', label: 'Home', glyph: '◈' },
  { href: '/maps', label: 'Maps', glyph: '◎' },
  { href: '/training', label: 'Train', glyph: '▤' },
  { href: '/community', label: 'Community', short: 'Social', glyph: '◐' },
  { href: '/you', label: 'You', glyph: '◇' },
];

export function TopNav({ displayName }: { displayName: string }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 border-b border-ink-600/60 bg-ink-900/85 backdrop-blur-lg">
      <div className="shell flex h-16 items-center justify-between gap-6">
        <div className="flex items-center gap-8">
          <Link
            href="/home"
            className="font-display text-lg font-bold tracking-[0.14em] text-bone-100"
          >
            FORGE
          </Link>
          <nav aria-label="Main" className="hidden md:block">
            <ul className="flex gap-1">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive(item.href) ? 'page' : undefined}
                    className={clsx(
                      'relative flex min-h-[44px] items-center rounded-control px-3.5 text-secondary font-medium transition-colors',
                      isActive(item.href)
                        ? 'text-bone-100'
                        : 'text-smoke-400 hover:bg-ink-800 hover:text-bone-100',
                    )}
                  >
                    {item.label}
                    {isActive(item.href) && (
                      <span
                        aria-hidden
                        className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-pill bg-signal"
                      />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/activities/new"
            className="inline-flex min-h-[40px] items-center gap-2 rounded-control bg-signal px-4 text-button font-semibold text-ink-900 transition-colors hover:bg-signal-400"
          >
            <span aria-hidden>+</span> Record
          </Link>
          <Link
            href="/you"
            aria-label={`Your profile, ${displayName}`}
            className="grid h-9 w-9 place-items-center rounded-pill border border-ink-600 bg-ink-800 text-caption font-semibold text-bone-100"
          >
            {initials(displayName)}
          </Link>
        </div>
      </div>
    </header>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-600 bg-ink-900/95 backdrop-blur-lg md:hidden"
    >
      <ul className="flex">
        {NAV.map((item) => (
          <li key={item.href} className="flex-1">
            <Link
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={clsx(
                'flex min-h-[58px] flex-col items-center justify-center gap-1 text-caption',
                isActive(item.href) ? 'text-signal' : 'text-smoke-400',
              )}
            >
              <span aria-hidden className="text-base leading-none">
                {item.glyph}
              </span>
              {item.short ?? item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
