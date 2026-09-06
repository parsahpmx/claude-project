import Link from 'next/link';
import { isEnabled, parseDisabledFeatures } from '@forge/contracts';
import { Card, Badge, EmptyState } from '@/components/ui/primitives';
import { createClient } from '@/lib/supabase/server';
import { formatDate, SPORT_LABEL } from '@/lib/format';

export const metadata = { title: 'Community' };
export const dynamic = 'force-dynamic';

/**
 * Community is deliberately secondary to performance (§46). It is a place to
 * find a challenge or a club, not a feed to scroll.
 *
 * Each block is behind its own flag, and a flag that is off means the block is
 * absent — not an empty panel promising something that does not exist.
 */
export default async function CommunityPage() {
  const disabled = parseDisabledFeatures(process.env.FORGE_DISABLED_FEATURES);
  const showChallenges = isEnabled('challenges', disabled);
  const showClubs = isEnabled('clubs', disabled);

  const supabase = await createClient();
  const [challenges, clubs] = await Promise.all([
    showChallenges
      ? supabase
          .from('challenges')
          .select('id, slug, name, description, metric, sport, target, starts_on, ends_on')
          .eq('published', true)
          .order('starts_on')
          .limit(8)
      : Promise.resolve({ data: null }),
    showClubs
      ? supabase
          .from('clubs')
          .select('id, slug, name, description, sport, location_name')
          .eq('privacy', 'public')
          .limit(8)
      : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-page-title font-display text-bone-100">Community</h1>
        <p className="mt-2 text-secondary muted">
          Challenges and clubs. Nothing here shares your training unless you choose to.
        </p>
      </header>

      {showChallenges && (
        <section aria-labelledby="challenges-heading">
          <h2 id="challenges-heading" className="eyebrow mb-4">
            Challenges
          </h2>
          {!challenges.data || challenges.data.length === 0 ? (
            <EmptyState
              title="No challenges running"
              body="New challenges open at the start of each month."
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {challenges.data.map((c) => (
                <li key={c.id}>
                  <Card interactive>
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-card-title text-bone-100">{c.name}</h3>
                      {c.sport && <Badge>{SPORT_LABEL[c.sport] ?? c.sport}</Badge>}
                    </div>
                    <p className="mt-2 text-secondary muted">{c.description}</p>
                    <p className="mt-4 text-caption muted tabular-nums">
                      {formatDate(c.starts_on)} — {formatDate(c.ends_on)}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {showClubs && (
        <section aria-labelledby="clubs-heading">
          <h2 id="clubs-heading" className="eyebrow mb-4">
            Clubs
          </h2>
          {!clubs.data || clubs.data.length === 0 ? (
            <EmptyState
              title="No public clubs yet"
              body="Clubs open up as the beta grows. Private clubs are invisible here by design — you only see a club you belong to."
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {clubs.data.map((club) => (
                <li key={club.id}>
                  <Card interactive>
                    <h3 className="text-card-title text-bone-100">{club.name}</h3>
                    <p className="mt-2 text-secondary muted">{club.description}</p>
                    {club.location_name && (
                      <p className="mt-3 text-caption muted">{club.location_name}</p>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="text-secondary muted">
        Looking for your own training?{' '}
        <Link href="/home" className="font-semibold text-signal hover:underline underline-offset-4">
          Home
        </Link>{' '}
        has today and this week.
      </p>
    </div>
  );
}
