import Link from 'next/link';
import { ButtonLink } from '@/components/ui/primitives';

// These are marketing paths only. /training, /maps and /community belong to the
// authenticated app, and a route group cannot claim a path another group serves.
const NAV = [
  { href: '/features', label: 'Features' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-ink-900">
      <header className="sticky top-0 z-40 border-b border-ink-600/60 bg-ink-900/85 backdrop-blur-lg">
        <div className="shell flex h-16 items-center justify-between gap-6">
          <Link href="/" className="font-display text-lg font-bold tracking-[0.14em] text-bone-100">
            FORGE
          </Link>
          <nav aria-label="Main" className="hidden gap-7 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-secondary muted transition-colors hover:text-bone-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-secondary muted transition-colors hover:text-bone-100"
            >
              Log in
            </Link>
            <ButtonLink href="/signup" size="sm">
              Start free beta
            </ButtonLink>
          </div>
        </div>
      </header>

      {/* min-w-0 is load-bearing: without it a flex child refuses to shrink
          below its content and one wide table scrolls the whole document. */}
      <main id="main" className="min-w-0 flex-1">
        {children}
      </main>

      <footer className="border-t border-ink-600/60 py-12">
        <div className="shell flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-base font-bold tracking-[0.14em] text-bone-100">
              FORGE
            </p>
            <p className="mt-1 text-secondary muted">Train. Track. Go further.</p>
          </div>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2">
            {[
              ['/about', 'About'],
              ['/privacy', 'Privacy'],
              ['/terms', 'Terms'],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href!}
                className="text-secondary muted transition-colors hover:text-bone-100"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="shell mt-8 text-caption muted">
          © 2026 FORGE. Beta software — features and data may change.
        </div>
      </footer>
    </div>
  );
}
