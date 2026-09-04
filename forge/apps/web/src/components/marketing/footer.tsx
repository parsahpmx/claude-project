import Link from 'next/link';

const COLUMNS = [
  {
    title: 'Train',
    links: [
      { href: '/programs', label: 'Programs' },
      { href: '/training', label: 'Workouts' },
      { href: '/recovery', label: 'Recovery' },
      { href: '/assessment', label: 'Fitness Assessment' },
    ],
  },
  {
    title: 'Support',
    links: [
      { href: '/coaching', label: 'Find a Coach' },
      { href: '/nutrition', label: 'Nutrition' },
      { href: '/community', label: 'Community' },
      { href: '/stories', label: 'Success Stories' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/pricing', label: 'Pricing' },
      { href: '/for-coaches', label: 'For Coaches' },
      { href: '/blog', label: 'Knowledge Hub' },
      { href: '/equipment', label: 'Equipment Store' },
    ],
  },
  {
    title: 'Product',
    links: [
      { href: '/app', label: 'Member App' },
      { href: '/coach', label: 'Coach Workspace' },
      { href: '/design-system', label: 'Design System' },
      { href: '/signin', label: 'Sign In' },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="dark-surface bg-ink-900 text-bone-200">
      <div className="shell py-16 sm:py-20">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_2fr]">
          <div>
            <p className="display text-display-sm">BUILD YOUR<br />STRONGEST SELF.</p>
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-bone-200/60">
              Training, nutrition, recovery and real coaching — personalised around you.
            </p>
            <Link
              href="/assessment"
              className="mt-7 inline-flex min-h-[48px] items-center rounded-[8px] bg-ember px-6 text-xs font-semibold uppercase tracking-[0.1em] text-bone-100 transition-colors hover:bg-ember-600"
            >
              Take the Assessment
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {COLUMNS.map((column) => (
              <nav key={column.title} aria-label={column.title}>
                <p className="eyebrow mb-4">{column.title}</p>
                <ul className="space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-sm text-bone-200/60 transition-colors hover:text-bone-100"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="rule my-12" />

        <div className="flex flex-col gap-4 text-xs text-bone-200/45 md:flex-row md:items-center md:justify-between">
          <p>© 2026 FORGE. A demonstration product. Not affiliated with any existing fitness company.</p>
          <p className="max-w-xl">
            FORGE is not a medical service. Training, nutrition and recovery guidance is general in nature —
            speak to a qualified healthcare professional before starting any programme, and about any injury or
            medical condition.
          </p>
        </div>
      </div>
    </footer>
  );
}
