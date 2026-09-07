import { describe, expect, it } from 'vitest';
import { isAuthEntryPath, isPublicPath, requiresSession } from './route-access';

describe('public paths', () => {
  it('serves the marketing and entry pages anonymously', () => {
    for (const path of [
      '/',
      '/features',
      '/how-it-works',
      '/pricing',
      '/about',
      '/privacy',
      '/terms',
      '/login',
      '/signup',
    ]) {
      expect(isPublicPath(path), path).toBe(true);
    }
  });

  it('serves the auth callback anonymously, or sign-in could never complete', () => {
    expect(isPublicPath('/auth/callback')).toBe(true);
    expect(isPublicPath('/auth/confirm')).toBe(true);
  });

  it('does not redirect framework internals', () => {
    expect(isPublicPath('/_next/webpack-hmr')).toBe(true);
    expect(isPublicPath('/_next/static/chunk.js')).toBe(true);
  });

  it('serves well-known crawler files', () => {
    expect(isPublicPath('/robots.txt')).toBe(true);
    expect(isPublicPath('/sitemap.xml')).toBe(true);
  });

  it('treats a trailing slash as the same path', () => {
    expect(isPublicPath('/pricing/')).toBe(true);
    expect(isPublicPath('/')).toBe(true);
  });
});

describe('guarded paths', () => {
  it('requires a session for every current member route', () => {
    for (const path of [
      '/home',
      '/feed',
      '/maps',
      '/training',
      '/community',
      '/you',
      '/activities',
      '/activities/new',
      '/goals',
      '/programs',
      '/progress',
      '/routes',
      '/routes/new',
      '/settings/privacy',
      '/onboarding',
      '/activity/abc-123',
      '/route/abc-123',
    ]) {
      expect(requiresSession(path), path).toBe(true);
    }
  });

  /**
   * The regression this module exists to prevent. Under the previous
   * protected-prefix allowlist these paths matched nothing and were served to
   * anonymous visitors. They must be protected before the routes exist, not
   * after someone remembers to add them.
   */
  it('protects routes that do not exist yet', () => {
    for (const path of [
      '/coach',
      '/coach/clients',
      '/gym',
      '/gym/members',
      '/gym/access',
      '/admin',
      '/admin/users',
      '/workouts',
      '/classes',
      '/messages',
      '/profile',
      '/settings',
      '/billing',
      '/anything-a-future-branch-adds',
    ]) {
      expect(requiresSession(path), path).toBe(true);
    }
  });

  it('does not let a public prefix be borrowed by a guarded route', () => {
    // `/privacy` is public marketing copy; `/settings/privacy` is the member's
    // own data and must not inherit that.
    expect(isPublicPath('/privacy')).toBe(true);
    expect(requiresSession('/settings/privacy')).toBe(true);
    // A path that merely starts with a public path's characters is not public.
    expect(requiresSession('/pricing-internal')).toBe(true);
    expect(requiresSession('/aboutus')).toBe(true);
  });
});

describe('auth entry paths', () => {
  it('identifies the pages a signed-in athlete should be redirected away from', () => {
    expect(isAuthEntryPath('/login')).toBe(true);
    expect(isAuthEntryPath('/signup')).toBe(true);
    expect(isAuthEntryPath('/home')).toBe(false);
    expect(isAuthEntryPath('/')).toBe(false);
  });
});
