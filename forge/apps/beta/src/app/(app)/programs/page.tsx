import { Card, Badge, EmptyState } from '@/components/ui/primitives';
import { createClient } from '@/lib/supabase/server';
import { SPORT_LABEL } from '@/lib/format';

export const metadata = { title: 'Programmes' };
export const dynamic = 'force-dynamic';

export default async function ProgramsPage() {
  const supabase = await createClient();
  const { data: programs } = await supabase
    .from('programs')
    .select(
      'slug, name, tagline, summary, sport, goal, weeks, sessions_per_week, session_minutes, difficulty, equipment',
    )
    .eq('published', true)
    .order('sport')
    .order('name');

  return (
    <div className="space-y-7">
      <header>
        <h1 className="text-page-title font-display text-bone-100">Programmes</h1>
        <p className="mt-2 text-secondary muted">
          Every programme carries a phase plan, a progression model and an equipment list you can
          check before you start.
        </p>
      </header>

      {!programs || programs.length === 0 ? (
        <EmptyState title="No programmes published" body="The catalogue is being prepared." />
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {programs.map((p) => (
            <li key={p.slug}>
              <Card interactive as="article" className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-section text-bone-100">{p.name}</h2>
                  <Badge>{SPORT_LABEL[p.sport] ?? p.sport}</Badge>
                </div>
                <p className="mt-2 text-secondary muted">{p.tagline}</p>
                <p className="mt-3 flex-1 text-secondary muted">{p.summary}</p>
                <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-ink-600 pt-4 text-secondary">
                  <div>
                    <dt className="text-caption muted">Weeks</dt>
                    <dd className="mt-0.5 tabular-nums text-bone-100">{p.weeks}</dd>
                  </div>
                  <div>
                    <dt className="text-caption muted">Per week</dt>
                    <dd className="mt-0.5 tabular-nums text-bone-100">{p.sessions_per_week}</dd>
                  </div>
                  <div>
                    <dt className="text-caption muted">Session</dt>
                    <dd className="mt-0.5 tabular-nums text-bone-100">{p.session_minutes}m</dd>
                  </div>
                </dl>
                {p.equipment.length > 0 && (
                  <p className="mt-3 text-caption muted">Needs: {p.equipment.join(', ')}</p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
