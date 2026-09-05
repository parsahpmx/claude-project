import Link from 'next/link';
import { AppSection, PageHeader } from '@/components/app/page-header';
import { Card, Chip, ButtonLink } from '@/components/ui/primitives';
import { EquipmentPicker } from '@/components/app/equipment-picker';
import { apiFetch, apiPublic } from '@/lib/api';
import type { MemberProfile, Program } from '@/lib/types';

export const metadata = { title: 'My equipment' };

export const dynamic = 'force-dynamic';

/** "Full gym" implies the individual items, exactly as the domain expands it. */
function expand(owned: readonly string[]): Set<string> {
  const set = new Set(owned);
  set.add('bodyweight');
  if (set.has('full-gym')) {
    for (const item of ['dumbbells', 'barbell', 'bench', 'rack', 'kettlebell', 'resistance-bands', 'cable-machine', 'cardio-equipment']) {
      set.add(item);
    }
  }
  return set;
}

export default async function MemberEquipmentPage() {
  const [profile, catalogue] = await Promise.all([
    apiFetch<{ profile: MemberProfile | null }>('/v1/me/profile'),
    apiPublic<{ programs: Program[] }>('/v1/catalog/programs'),
  ]);

  const owned = profile.profile?.equipment ?? ['bodyweight'];
  const available = expand(owned);
  const unlocked = catalogue.programs.filter((p) => p.equipment.every((item) => available.has(item)));
  const locked = catalogue.programs.filter((p) => !p.equipment.every((item) => available.has(item)));

  return (
    <AppSection>
      <PageHeader
        eyebrow="Equipment"
        title="MY EQUIPMENT"
        lead="We only recommend workouts you can actually perform with your setup. Change this and every remaining session in your block is re-checked."
        action={<ButtonLink href="/equipment" variant="ghost">Equipment Store</ButtonLink>}
      />

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <EquipmentPicker owned={owned} />

        <div className="space-y-6">
          <Card tone="dark">
            <p className="eyebrow mb-3">Unlocked</p>
            <p className="display text-display-sm text-bone-100">
              {unlocked.length}
              <span className="text-lg font-normal text-muted"> of {catalogue.programs.length}</span>
            </p>
            <p className="mt-2 text-sm text-bone-200/60">programmes you can run right now</p>

            <div className="rule my-6" />

            <ul className="space-y-2">
              {unlocked.slice(0, 8).map((program) => (
                <li key={program.slug}>
                  <Link
                    href={`/programs/${program.slug}`}
                    className="flex items-center justify-between gap-3 text-sm text-bone-200/80 transition-colors hover:text-bone-100"
                  >
                    <span className="truncate">{program.name}</span>
                    <span aria-hidden className="shrink-0 text-status-good">✓</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          {locked.length > 0 && (
            <Card>
              <p className="eyebrow mb-4">Needs more equipment</p>
              <ul className="space-y-3">
                {locked.map((program) => {
                  const missing = program.equipment.filter((item) => !available.has(item));
                  return (
                    <li key={program.slug} className="border-b border-ink-900/8 pb-3 last:border-0">
                      <Link href={`/programs/${program.slug}`} className="text-sm font-medium hover:underline">
                        {program.name}
                      </Link>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {missing.map((item) => (
                          <Chip key={item} tone="warn" size="sm">needs {item.replace(/-/g, ' ')}</Chip>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-5 text-xs leading-relaxed text-muted">
                Every product in the store lists exactly which programmes it unlocks, so you can check before
                you buy rather than after.
              </p>
            </Card>
          )}
        </div>
      </div>
    </AppSection>
  );
}
