import Link from 'next/link';
import { RouteGlyph } from '@/components/marketing/route-glyph';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <main className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <Link href="/" className="font-display text-lg font-bold tracking-[0.14em] text-bone-100">
          FORGE
        </Link>
        <div className="mx-auto w-full max-w-sm py-14">{children}</div>
        <p className="text-caption muted">© 2026 FORGE · Beta</p>
      </main>

      <aside aria-hidden className="relative hidden overflow-hidden border-l border-ink-600 bg-ink-800 lg:block">
        <div className="absolute inset-0 text-signal/35">
          <RouteGlyph seed="forge-auth-panel" className="h-full w-full" strokeWidth={1.6} />
        </div>
        <div className="absolute inset-x-10 bottom-10">
          <p className="text-section text-bone-100">Train. Track. Go further.</p>
          <p className="mt-2 text-secondary muted">
            Your activities are private by default. You decide what anyone else sees.
          </p>
        </div>
      </aside>
    </div>
  );
}
