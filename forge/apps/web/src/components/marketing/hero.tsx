import Link from 'next/link';
import { generateImage } from '@/lib/imagery';

/**
 * Homepage hero.
 *
 * Full-bleed generated cinematography behind an editorial headline, with the
 * app mockup floating over the lower right. The headline is the only thing
 * that must survive a 390px viewport, so everything else stacks below it.
 */
export function Hero() {
  const backdrop = generateImage('hero-athlete-lift');

  return (
    <section className="dark-surface relative isolate flex min-h-[100svh] items-end overflow-hidden bg-ink-900 pb-16 pt-32 text-bone-200 sm:pb-24">
      <div aria-hidden className="grain absolute inset-0 -z-10" style={{ background: backdrop.background }} />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-t from-ink-900 via-ink-900/70 to-ink-900/40"
      />

      <div className="shell">
        <div className="grid gap-12 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
          <div className="animate-fade-up">
            <p className="eyebrow mb-6 text-bone-200/70">Personalised performance system</p>
            <h1 className="display text-display-xl text-balance text-bone-100">
              BUILD YOUR
              <br />
              STRONGEST SELF.
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-bone-200/75">
              A complete performance system combining personalised training, nutrition, recovery and real
              coaching.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/assessment"
                className="inline-flex min-h-[56px] items-center justify-center rounded-[10px] bg-ember px-8 text-sm font-semibold uppercase tracking-[0.08em] text-bone-100 shadow-lift transition-all duration-200 hover:bg-ember-600 active:translate-y-px"
              >
                Start Your 7-Day Free Trial
              </Link>
              <Link
                href="/assessment"
                className="inline-flex min-h-[56px] items-center justify-center rounded-[10px] border border-bone-200/25 px-8 text-sm font-semibold uppercase tracking-[0.08em] text-bone-100 transition-all duration-200 hover:border-bone-200/60 hover:bg-bone-200/[0.06]"
              >
                Take the Fitness Assessment
              </Link>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-bone-200/65">
              <span className="flex items-center gap-2">
                <span aria-hidden className="text-ember">★★★★★</span>
                <span>4.9 Member Rating</span>
              </span>
              <span className="hidden h-4 w-px bg-bone-200/20 sm:block" />
              <span>Cancel anytime.</span>
            </div>
          </div>

          <AppMockup />
        </div>
      </div>
    </section>
  );
}

/** The floating phone. Real content, real numbers — it is the actual product. */
function AppMockup() {
  return (
    <div className="animate-fade-up justify-self-center lg:justify-self-end" style={{ animationDelay: '160ms' }}>
      <div className="w-[280px] rounded-[32px] border border-bone-200/15 bg-ink-800/85 p-3 shadow-lift backdrop-blur-xl sm:w-[300px]">
        <div className="rounded-[24px] bg-ink-900 p-5">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Today</p>
            <span className="text-[0.625rem] tabular-nums opacity-50">07:12</span>
          </div>

          <p className="display mt-3 text-xl leading-none text-bone-100">GOOD MORNING,<br />ALEX.</p>

          <div className="mt-5 rounded-[12px] border border-bone-200/10 bg-bone-200/[0.04] p-4">
            <div className="flex items-baseline justify-between">
              <p className="eyebrow">Today&rsquo;s workout</p>
              <span className="text-[0.625rem] opacity-55">45 min</span>
            </div>
            <p className="mt-2 font-semibold text-bone-100">Upper Body Strength</p>
            <p className="mt-1 text-xs opacity-55">Coach Maya · Intermediate · Gym</p>
            <div className="mt-3 h-1 overflow-hidden rounded-pill bg-bone-200/10">
              <div className="h-full w-[32%] rounded-pill bg-ember" />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <MockTile label="Readiness" value="82" hint="Ready" />
            <MockTile label="Week" value="4/5" hint="Sessions" />
          </div>

          <div className="mt-3 rounded-[12px] border border-bone-200/10 p-3">
            <p className="eyebrow mb-2">Current program</p>
            <p className="text-xs font-medium text-bone-100">12 Week Performance Build</p>
            <p className="mt-1 text-[0.625rem] opacity-50">Week 5 · Build phase</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MockTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[12px] border border-bone-200/10 p-3">
      <p className="eyebrow">{label}</p>
      <p className="display mt-1.5 text-lg leading-none text-bone-100 tabular-nums">{value}</p>
      <p className="mt-1 text-[0.625rem] opacity-50">{hint}</p>
    </div>
  );
}
