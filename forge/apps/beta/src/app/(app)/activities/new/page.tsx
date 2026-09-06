import { RecordActivityForm } from '@/components/app/record-form';
import { getPrivacySettings } from '@/lib/queries';

export const metadata = { title: 'Record an activity' };
export const dynamic = 'force-dynamic';

export default async function RecordPage() {
  const privacy = await getPrivacySettings();

  return (
    <div className="max-w-xl space-y-7">
      <header>
        <h1 className="text-page-title font-display text-bone-100">Record an activity</h1>
        <p className="mt-2 text-secondary muted">
          Log a session you have already done. Uploading a GPS file comes later in the
          beta — for now this covers the numbers.
        </p>
      </header>
      <RecordActivityForm
        defaultVisibility={privacy?.defaultActivityVisibility ?? 'followers'}
      />
    </div>
  );
}
