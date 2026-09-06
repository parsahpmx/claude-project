import Link from 'next/link';
import { signOut } from '@/app/(auth)/actions';
import { Card, Badge, Button } from '@/components/ui/primitives';
import { getSessionProfile, getPrivacySettings, getMyActivities } from '@/lib/queries';
import { formatDistance, formatDuration, SPORT_LABEL } from '@/lib/format';

export const metadata = { title: 'You' };
export const dynamic = 'force-dynamic';

const LINKS = [
  { href: '/activities', label: 'Activities', hint: 'Your full training log' },
  { href: '/progress', label: 'Progress', hint: 'Load, consistency and records' },
  { href: '/goals', label: 'Goals', hint: 'What you are working toward' },
  { href: '/routes', label: 'Routes', hint: 'Routes you have built and saved' },
  { href: '/settings/privacy', label: 'Privacy', hint: 'Who can see what' },
];

export default async function YouPage() {
  const [profile, privacy, activities] = await Promise.all([
    getSessionProfile(),
    getPrivacySettings(),
    getMyActivities(50),
  ]);

  const units = profile?.units ?? 'metric';
  const totalMinutes = Math.round(activities.reduce((n, a) => n + a.movingS, 0) / 60);
  const totalDistance = activities.reduce((n, a) => n + a.distanceM, 0);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="text-page-title font-display text-bone-100">
            {profile?.displayName || 'Athlete'}
          </h1>
          <p className="mt-1.5 text-secondary muted">
            {profile?.username ? `@${profile.username}` : 'No username set'}
            {profile?.locationName ? ` · ${profile.locationName}` : ''}
          </p>
          {profile?.bio && <p className="mt-3 max-w-prose text-body muted">{profile.bio}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {profile?.primarySport && (
              <Badge tone="accent">{SPORT_LABEL[profile.primarySport]}</Badge>
            )}
            {privacy && (
              <Badge>
                Profile:{' '}
                {privacy.profileVisibility === 'private'
                  ? 'Only me'
                  : privacy.profileVisibility === 'followers'
                    ? 'Followers'
                    : 'Anyone'}
              </Badge>
            )}
          </div>
        </div>
        <form action={signOut}>
          <Button variant="ghost" type="submit">
            Sign out
          </Button>
        </form>
      </header>

      <section aria-labelledby="totals-heading">
        <h2 id="totals-heading" className="eyebrow mb-4">
          Recent totals
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <p className="eyebrow">Sessions</p>
            <p className="mt-2 text-metric-l tabular-nums text-bone-100">{activities.length}</p>
          </Card>
          <Card>
            <p className="eyebrow">Training time</p>
            <p className="mt-2 text-metric-l tabular-nums text-bone-100">
              {formatDuration(totalMinutes * 60)}
            </p>
          </Card>
          <Card>
            <p className="eyebrow">Distance</p>
            <p className="mt-2 text-metric-l tabular-nums text-bone-100">
              {formatDistance(totalDistance, units)}
            </p>
          </Card>
        </div>
      </section>

      <section aria-labelledby="links-heading">
        <h2 id="links-heading" className="eyebrow mb-4">
          Your data
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="block rounded-card border border-ink-600 bg-ink-800 p-5 transition-colors hover:border-smoke-400"
              >
                <p className="text-card-title text-bone-100">{link.label}</p>
                <p className="mt-1 text-secondary muted">{link.hint}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
