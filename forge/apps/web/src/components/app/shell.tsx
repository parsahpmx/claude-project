'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import clsx from 'clsx';
import { useRouter } from 'next/navigation';

/**
 * The application shell.
 *
 * Desktop gets a persistent left sidebar; mobile gets a bottom bar with five
 * destinations and a floating primary action. They are not the same navigation
 * squeezed into different widths — the mobile bar carries the five things
 * somebody standing in a gym needs, and everything else lives behind Profile.
 */

export interface NavItem {
  href: string;
  label: string;
  glyph: string;
  badge?: number;
}

const MEMBER_NAV: NavItem[] = [
  { href: '/app', label: 'Home', glyph: '◈' },
  { href: '/app/plan', label: 'My Plan', glyph: '▤' },
  { href: '/app/programs', label: 'Programs', glyph: '▦' },
  { href: '/app/workouts', label: 'Workouts', glyph: '▶' },
  { href: '/app/nutrition', label: 'Nutrition', glyph: '◐' },
  { href: '/app/progress', label: 'Progress', glyph: '◤' },
  { href: '/app/recovery', label: 'Recovery', glyph: '◍' },
  { href: '/app/coach', label: 'Coach', glyph: '◉' },
  { href: '/app/ai', label: 'FORGE AI', glyph: '✦' },
  { href: '/app/community', label: 'Community', glyph: '◎' },
  { href: '/app/challenges', label: 'Challenges', glyph: '★' },
  { href: '/app/calendar', label: 'Calendar', glyph: '▣' },
  { href: '/app/messages', label: 'Messages', glyph: '✉' },
];

const MEMBER_FOOTER: NavItem[] = [
  { href: '/app/profile', label: 'Profile', glyph: '◔' },
  { href: '/app/settings', label: 'Settings', glyph: '⚙' },
  { href: '/app/help', label: 'Help', glyph: '?' },
];

const MEMBER_MOBILE: NavItem[] = [
  { href: '/app', label: 'Home', glyph: '◈' },
  { href: '/app/plan', label: 'Plan', glyph: '▤' },
  { href: '/app/workouts', label: 'Explore', glyph: '▶' },
  { href: '/app/coach', label: 'Coach', glyph: '◉' },
  { href: '/app/profile', label: 'Profile', glyph: '◔' },
];

const COACH_NAV: NavItem[] = [
  { href: '/coach', label: 'Overview', glyph: '◈' },
  { href: '/coach/clients', label: 'Clients', glyph: '◎' },
  { href: '/coach/programs', label: 'Programs', glyph: '▦' },
  { href: '/coach/calendar', label: 'Calendar', glyph: '▣' },
  { href: '/coach/messages', label: 'Messages', glyph: '✉' },
  { href: '/coach/check-ins', label: 'Check-ins', glyph: '☑' },
  { href: '/coach/analytics', label: 'Analytics', glyph: '◤' },
  { href: '/coach/payments', label: 'Payments', glyph: '◇' },
];

const COACH_MOBILE: NavItem[] = [
  { href: '/coach', label: 'Overview', glyph: '◈' },
  { href: '/coach/clients', label: 'Clients', glyph: '◎' },
  { href: '/coach/check-ins', label: 'Check-ins', glyph: '☑' },
  { href: '/coach/messages', label: 'Messages', glyph: '✉' },
  { href: '/coach/calendar', label: 'Calendar', glyph: '▣' },
];

export function AppShell({
  children,
  role,
  user,
  unreadNotifications = 0,
  primaryAction,
}: {
  children: React.ReactNode;
  role: 'member' | 'coach';
  user: { firstName: string; lastName: string; email: string };
  unreadNotifications?: number;
  primaryAction?: { href: string; label: string } | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenu, setMobileMenu] = useState(false);

  const nav = role === 'coach' ? COACH_NAV : MEMBER_NAV;
  const mobileNav = role === 'coach' ? COACH_MOBILE : MEMBER_MOBILE;
  const home = role === 'coach' ? '/coach' : '/app';

  const isActive = (href: string) => (href === home ? pathname === href : pathname.startsWith(href));

  const signOut = async () => {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  };

  return (
    <div className="min-h-dvh bg-bone-200">
      {/* -------------------------------------------------- desktop sidebar */}
      <aside className="dark-surface fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-bone-200/10 bg-ink-900 text-bone-200 lg:flex">
        <div className="flex h-[72px] items-center px-6">
          <Link href="/" className="display text-xl tracking-[0.08em] text-bone-100">FORGE</Link>
          {role === 'coach' && <span className="ml-2 text-[0.625rem] uppercase tracking-[0.14em] text-ember">Coach</span>}
        </div>

        <nav aria-label="Application" className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-0.5">
            {nav.map((item) => (
              <li key={item.href}>
                <NavLink item={item} active={isActive(item.href)} />
              </li>
            ))}
          </ul>
        </nav>

        {role === 'member' && (
          <div className="border-t border-bone-200/10 px-3 py-4">
            <ul className="space-y-0.5">
              {MEMBER_FOOTER.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} active={isActive(item.href)} />
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="border-t border-bone-200/10 p-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ember text-xs font-semibold text-bone-100"
            >
              {user.firstName.charAt(0)}{user.lastName.charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-bone-100">{user.firstName} {user.lastName}</p>
              <p className="truncate text-[0.6875rem] text-bone-200/45">{user.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-3 w-full rounded-[6px] border border-bone-200/15 py-2 text-[0.6875rem] uppercase tracking-[0.1em] text-bone-200/60 transition-colors hover:border-bone-200/40 hover:text-bone-100"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* -------------------------------------------------- mobile top bar */}
      <header className="dark-surface sticky top-0 z-40 border-b border-bone-200/10 bg-ink-900 text-bone-200 lg:hidden">
        <div className="flex h-[60px] items-center justify-between px-4">
          <Link href={home} className="display text-lg tracking-[0.08em] text-bone-100">FORGE</Link>
          <div className="flex items-center gap-1">
            <Link
              href="/app/notifications"
              className="relative grid h-11 w-11 place-items-center rounded-full text-bone-200/70"
              aria-label={`Notifications${unreadNotifications > 0 ? `, ${unreadNotifications} unread` : ''}`}
            >
              <span aria-hidden>◔</span>
              {unreadNotifications > 0 && (
                <span aria-hidden className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-ember" />
              )}
            </Link>
            <button
              type="button"
              aria-expanded={mobileMenu}
              onClick={() => setMobileMenu((v) => !v)}
              className="grid h-11 w-11 place-items-center rounded-[8px] text-bone-100"
            >
              <span className="sr-only">{mobileMenu ? 'Close menu' : 'Open menu'}</span>
              <span aria-hidden>{mobileMenu ? '✕' : '☰'}</span>
            </button>
          </div>
        </div>

        {mobileMenu && (
          <nav aria-label="All sections" className="max-h-[70vh] overflow-y-auto border-t border-bone-200/10 px-3 py-3">
            <ul className="grid grid-cols-2 gap-1">
              {[...nav, ...(role === 'member' ? MEMBER_FOOTER : [])].map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMobileMenu(false)}
                    className="flex min-h-[48px] items-center gap-3 rounded-[8px] px-3 text-sm text-bone-200/75"
                  >
                    <span aria-hidden className="w-4 text-center opacity-50">{item.glyph}</span>
                    {item.label}
                  </Link>
                </li>
              ))}
              <li className="col-span-2 mt-2">
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="w-full rounded-[8px] border border-bone-200/15 py-3 text-xs uppercase tracking-[0.1em] text-bone-200/60"
                >
                  Sign out
                </button>
              </li>
            </ul>
          </nav>
        )}
      </header>

      {/* -------------------------------------------------- content */}
      <div className="lg:pl-[248px]">
        <main id="main" className="min-w-0 overflow-x-clip pb-28 lg:pb-16">{children}</main>
      </div>

      {/* -------------------------------------------------- mobile bottom nav */}
      <nav
        aria-label="Primary"
        className="dark-surface fixed inset-x-0 bottom-0 z-40 border-t border-bone-200/10 bg-ink-900/95 backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="flex">
          {mobileNav.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'flex min-h-[60px] flex-col items-center justify-center gap-1 text-[0.625rem]',
                    active ? 'text-bone-100' : 'text-bone-200/45',
                  )}
                >
                  <span aria-hidden className="text-base">{item.glyph}</span>
                  {item.label}
                  {active && <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-pill bg-ember" />}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {primaryAction && (
        <Link
          href={primaryAction.href}
          className="fixed bottom-[86px] right-4 z-40 flex min-h-[52px] items-center rounded-pill bg-ember px-6 text-xs font-semibold uppercase tracking-[0.1em] text-bone-100 shadow-lift lg:hidden"
        >
          {primaryAction.label}
        </Link>
      )}
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'group relative flex min-h-[42px] items-center gap-3 rounded-[8px] px-3 text-sm transition-colors duration-200',
        active ? 'bg-bone-200/[0.08] text-bone-100' : 'text-bone-200/60 hover:bg-bone-200/[0.04] hover:text-bone-100',
      )}
    >
      <span aria-hidden className={clsx('w-4 text-center text-xs', active ? 'text-ember' : 'opacity-50')}>
        {item.glyph}
      </span>
      <span className="flex-1">{item.label}</span>
      {typeof item.badge === 'number' && item.badge > 0 && (
        <span className="rounded-pill bg-ember px-1.5 py-0.5 text-[0.625rem] font-semibold tabular-nums text-bone-100">
          {item.badge}
        </span>
      )}
      {active && <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-pill bg-ember" />}
    </Link>
  );
}
