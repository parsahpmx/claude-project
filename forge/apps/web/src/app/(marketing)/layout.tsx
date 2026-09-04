import { MarketingHeader } from '@/components/marketing/header';
import { MarketingFooter } from '@/components/marketing/footer';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    // `min-w-0` on the flex child is load-bearing: without it a flex item
    // refuses to shrink below its content, so one wide table inside a page
    // makes the whole document scroll sideways instead of the table scrolling
    // inside its own container.
    <div className="flex min-h-dvh flex-col bg-bone-200">
      <MarketingHeader />
      <main id="main" className="min-w-0 flex-1">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
