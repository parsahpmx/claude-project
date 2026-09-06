import { getPrivacySettings, getPrivateZones } from '@/lib/queries';
import { PrivacyForm } from '@/components/app/privacy-form';
import { ErrorState } from '@/components/ui/primitives';

export const metadata = { title: 'Privacy' };
export const dynamic = 'force-dynamic';

/**
 * The privacy centre.
 *
 * A first-class page rather than a tab inside settings, because it is where the
 * most consequential decisions in the product are made and it should be
 * possible to link someone directly to it.
 */
export default async function PrivacyPage() {
  const [settings, zones] = await Promise.all([getPrivacySettings(), getPrivateZones()]);

  if (!settings) {
    return (
      <ErrorState
        title="We could not load your privacy settings"
        body="Your settings are unchanged. Reload the page, and if it keeps happening let us know through beta feedback."
      />
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      <header>
        <h1 className="text-page-title font-display text-bone-100">Privacy</h1>
        <p className="mt-2 text-body muted">
          FORGE starts closed and opens only where you say so. Everything here takes effect
          immediately, including on activities you have already recorded.
        </p>
      </header>

      <PrivacyForm settings={settings} zoneCount={zones.length} />
    </div>
  );
}
