import Link from 'next/link';
import { MarketingHeader } from '@/components/marketing/header';
import { MarketingFooter } from '@/components/marketing/footer';
import { Section, ButtonLink } from '@/components/ui/primitives';

export const metadata = {
  title: 'Page not found',
  description: 'That page does not exist. Here is where to go instead.',
};

/**
 * 404.
 *
 * A dead end is still a screen someone is standing on, so it answers the same
 * question every other screen answers: what should I do next. The links are
 * the four places a lost visitor actually wants.
 */
export default function NotFound() {
  const routes = [
    { href: '/programs', label: 'Programme library', hint: 'Twelve programmes, filtered by goal and kit' },
    { href: '/coaching', label: 'Find a coach', hint: 'Browse coaches by speciality and availability' },
    { href: '/assessment', label: 'Take the assessment', hint: 'Ten questions, then a plan built around them' },
    { href: '/app', label: 'Your dashboard', hint: 'If you already train with FORGE' },
  ];

  return (
    <div className="light-surface flex min-h-dvh flex-col bg-bone-200">
      <MarketingHeader />
      <main id="main" className="min-w-0 flex-1">
        <Section tone="dark" size="lg">
          <div className="pt-10">
            <p className="eyebrow mb-6">Error 404</p>
            <h1 className="display max-w-3xl text-display-lg text-balance">
              THAT PAGE ISN&rsquo;T HERE.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              The link may be old, or the page may have moved. Nothing is wrong with your account.
            </p>
            <div className="mt-10">
              <ButtonLink href="/" size="lg">Back to the homepage</ButtonLink>
            </div>
          </div>
        </Section>

        <Section tone="light" size="md">
          <h2 className="eyebrow mb-8">Or pick up from here</h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {routes.map((route) => (
              <li key={route.href}>
                <Link
                  href={route.href}
                  className="light-surface block rounded-card border border-ink-900/10 bg-bone-100 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift"
                >
                  <p className="font-semibold">{route.label}</p>
                  <p className="mt-1 text-sm text-muted">{route.hint}</p>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      </main>
      <MarketingFooter />
    </div>
  );
}
