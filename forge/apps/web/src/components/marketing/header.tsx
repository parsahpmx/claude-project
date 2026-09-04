'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import clsx from 'clsx';

const NAV = [
  { href: '/training', label: 'Training' },
  { href: '/programs', label: 'Programs' },
  { href: '/nutrition', label: 'Nutrition' },
  { href: '/coaching', label: 'Coaching' },
  { href: '/recovery', label: 'Recovery' },
  { href: '/community', label: 'Community' },
  { href: '/equipment', label: 'Equipment' },
  { href: '/for-coaches', label: 'For Coaches' },
  { href: '/pricing', label: 'Pricing' },
];

/**
 * Marketing header.
 *
 * Transparent over the hero, then blurred and opaque once the page scrolls —
 * the transition is what tells you the header is pinned rather than part of
 * the artwork.
 */
export function MarketingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header
      className={clsx(
        'dark-surface fixed inset-x-0 top-0 z-50 transition-all duration-300 ease-forge',
        scrolled || open
          ? 'border-b border-bone-200/10 bg-ink-900/90 backdrop-blur-xl'
          : 'bg-transparent',
      )}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[6px] focus:bg-ember focus:px-4 focus:py-2 focus:text-sm focus:text-bone-100"
      >
        Skip to content
      </a>

      <div className="shell flex h-[72px] items-center justify-between gap-6">
        <Link href="/" className="display shrink-0 text-xl tracking-[0.08em] text-bone-100">
          FORGE
        </Link>

        <nav aria-label="Primary" className="hidden xl:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={clsx(
                      'relative rounded-[6px] px-3 py-2 text-[0.8125rem] font-medium transition-colors',
                      active ? 'text-bone-100' : 'text-bone-200/60 hover:text-bone-100',
                    )}
                  >
                    {item.label}
                    {active && <span aria-hidden className="absolute inset-x-3 -bottom-0.5 h-px bg-ember" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/programs"
            aria-label="Search programmes"
            className="hidden h-10 w-10 place-items-center rounded-full text-bone-200/70 transition-colors hover:bg-bone-200/10 hover:text-bone-100 sm:grid"
          >
            <span aria-hidden>⌕</span>
          </Link>
          <Link
            href="/signin"
            className="hidden min-h-[44px] items-center px-4 text-[0.8125rem] font-medium text-bone-200/80 transition-colors hover:text-bone-100 sm:inline-flex"
          >
            Sign In
          </Link>
          <Link
            href="/assessment"
            className="hidden min-h-[44px] items-center rounded-[8px] bg-ember px-5 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-bone-100 transition-all hover:bg-ember-600 sm:inline-flex"
          >
            Start Free Trial
          </Link>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
            className="grid h-11 w-11 place-items-center rounded-[8px] text-bone-100 transition-colors hover:bg-bone-200/10 xl:hidden"
          >
            <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
            <span aria-hidden className="text-lg">{open ? '✕' : '☰'}</span>
          </button>
        </div>
      </div>

      {open && (
        <nav id="mobile-nav" aria-label="Primary mobile" className="border-t border-bone-200/10 xl:hidden">
          <ul className="shell grid gap-1 py-4">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex min-h-[48px] items-center rounded-[8px] px-3 text-sm text-bone-200/80 transition-colors hover:bg-bone-200/[0.06] hover:text-bone-100"
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li className="mt-3 grid gap-2 sm:hidden">
              <Link href="/signin" className="flex min-h-[48px] items-center justify-center rounded-[8px] border border-bone-200/20 text-sm text-bone-100">
                Sign In
              </Link>
              <Link href="/assessment" className="flex min-h-[48px] items-center justify-center rounded-[8px] bg-ember text-xs font-semibold uppercase tracking-[0.1em] text-bone-100">
                Start Free Trial
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
