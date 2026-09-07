import { cookies } from 'next/headers';

/**
 * Proof that someone reached the password form through a recovery email.
 *
 * A recovery link creates an ordinary Supabase session, so "is there a session"
 * cannot distinguish *I proved control of the mailbox* from *I am simply signed
 * in on this device*. Without that distinction, anyone holding a borrowed
 * session could set a new password and lock the account's owner out.
 *
 * The auth callback sets this cookie after exchanging a code that arrived by
 * email, and nothing else sets it. It is httpOnly, so page scripts cannot forge
 * it, and short-lived, so an abandoned tab does not leave the door open.
 *
 * This is not a replacement for re-authentication on a future
 * "change my password" settings screen — that screen should ask for the current
 * password. It is the narrower guarantee the recovery flow needs.
 */
export const RECOVERY_COOKIE = 'forge-recovery';

/** Long enough to choose a password, short enough not to linger. */
export const RECOVERY_WINDOW_SECONDS = 15 * 60;

/** The only destination the callback will vouch for. */
export const RECOVERY_PATH = '/reset-password';

/** True when this request carries recovery proof from the callback. */
export async function hasRecoveryProof(): Promise<boolean> {
  const store = await cookies();
  return store.get(RECOVERY_COOKIE)?.value === '1';
}

/**
 * Spend the proof.
 *
 * Called once the password has actually changed, so a single emailed link
 * cannot be replayed to change it again later from the same browser.
 */
export async function clearRecoveryProof(): Promise<void> {
  const store = await cookies();
  try {
    store.set(RECOVERY_COOKIE, '', { path: '/', maxAge: 0 });
  } catch {
    // Read-only cookie store (a Server Component). The cookie expires on its
    // own, and the action that matters clears it from a writable context.
  }
}
