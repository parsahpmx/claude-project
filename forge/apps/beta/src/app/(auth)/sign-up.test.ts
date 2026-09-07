import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * What happens after "Create account", when the project requires a confirmed
 * email.
 *
 * This is the case that used to strand people. `supabase.auth.signUp()` returns
 * a session only when email confirmation is *off*; with it on, the account is
 * created and nobody is signed in. The action destructured only `error`, so it
 * could not tell the two apart and redirected to /onboarding regardless — a
 * route that needs a session, so middleware bounced the new account to /login
 * with no explanation, and the password they had just chosen was then refused
 * with "confirm your email first".
 *
 * These tests pin the distinction: no session means say so, a session means go
 * to onboarding.
 */

const signUpMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signUp: signUpMock } }),
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'localhost:3100' }),
  cookies: async () => ({ get: () => undefined, set: () => {}, getAll: () => [] }),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// `redirect()` throws in Next so that nothing after it runs. Mirror that here,
// with the destination on the error, so a test can assert where it went.
class RedirectError extends Error {
  constructor(readonly to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectError(to);
  },
}));

const { signUp } = await import('./actions');

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

const VALID = {
  displayName: 'Pars',
  email: 'someone@example.com',
  password: 'a-long-enough-password',
};

describe('signUp', () => {
  beforeEach(() => {
    signUpMock.mockReset();
  });

  it('tells the person to confirm their email when no session comes back', async () => {
    signUpMock.mockResolvedValue({
      data: { user: { id: 'u1' }, session: null },
      error: null,
    });

    const state = await signUp({}, form(VALID));

    expect(state.notice).toMatch(/confirm your email/i);
    expect(state.error).toBeUndefined();
  });

  it('does not send a session-less signup to a route that needs a session', async () => {
    signUpMock.mockResolvedValue({
      data: { user: { id: 'u1' }, session: null },
      error: null,
    });

    // A redirect would throw. Reaching the assertion at all is the point.
    await expect(signUp({}, form(VALID))).resolves.toBeTruthy();
  });

  it('goes to onboarding when Supabase did sign the person in', async () => {
    signUpMock.mockResolvedValue({
      data: { user: { id: 'u1' }, session: { access_token: 't' } },
      error: null,
    });

    await expect(signUp({}, form(VALID))).rejects.toThrow('NEXT_REDIRECT:/onboarding');
  });

  it('asks Supabase to send the confirmation link back to this origin', async () => {
    signUpMock.mockResolvedValue({ data: { user: null, session: null }, error: null });

    await signUp({}, form(VALID));

    expect(signUpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: 'http://localhost:3100/auth/callback?next=/onboarding',
        }),
      }),
    );
  });

  it('says the same thing for an address that is already taken', async () => {
    // Supabase's anti-enumeration shape: a user with no identities, no session,
    // and no error. The UI must not turn that into "already registered".
    signUpMock.mockResolvedValue({
      data: { user: { id: 'u1', identities: [] }, session: null },
      error: null,
    });

    const state = await signUp({}, form(VALID));

    expect(state.notice).toMatch(/confirm your email/i);
    expect(JSON.stringify(state)).not.toMatch(/already/i);
  });

  it('still rejects a short password before calling Supabase', async () => {
    const state = await signUp({}, form({ ...VALID, password: 'short' }));

    expect(state.fieldErrors?.password).toBeTruthy();
    expect(signUpMock).not.toHaveBeenCalled();
  });
});
