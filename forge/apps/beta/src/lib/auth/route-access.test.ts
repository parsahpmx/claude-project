import { describe, expect, it } from 'vitest';
import { classifyRoute, isAuthEntryPath, isPublicPath, requiresSession } from './route-access';

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

  it('serves the password recovery pages anonymously', () => {
    // Someone locked out of their account is by definition signed out; gating
    // these would send them to the one page they cannot get past.
    expect(isPublicPath('/forgot-password')).toBe(true);
    expect(isPublicPath('/reset-password')).toBe(true);
    expect(classifyRoute('/forgot-password')).toBe('public');
    expect(classifyRoute('/reset-password')).toBe('public');
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

describe('route classification', () => {
  it('classifies public marketing paths', () => {
    for (const p of ['/', '/pricing', '/login', '/auth/callback']) {
      expect(classifyRoute(p), p).toBe('public');
    }
  });

  it('classifies the current member area', () => {
    for (const p of ['/home', '/feed', '/goals', '/activities/new', '/settings/privacy']) {
      expect(classifyRoute(p), p).toBe('member');
    }
  });

  /**
   * These areas do not exist yet. The classification is declared first so that
   * whoever builds them cannot quietly ship a page that only checks for a
   * session — the class says which permission its layout must require.
   */
  it('classifies the coach area', () => {
    expect(classifyRoute('/coach')).toBe('coach');
    expect(classifyRoute('/coach/clients')).toBe('coach');
    expect(classifyRoute('/coach/clients/abc-123')).toBe('coach');
  });

  it('classifies the gym area as organization-scoped', () => {
    expect(classifyRoute('/gym')).toBe('organization');
    expect(classifyRoute('/gym/members')).toBe('organization');
    expect(classifyRoute('/gym/access')).toBe('organization');
  });

  it('classifies the admin area as platform-scoped', () => {
    expect(classifyRoute('/admin')).toBe('platform');
    expect(classifyRoute('/admin/users')).toBe('platform');
    expect(classifyRoute('/admin/audit')).toBe('platform');
  });

  it('does not let a lookalike path borrow a privileged class', () => {
    // `/coaching` is marketing copy about coaching, not the coach console.
    expect(classifyRoute('/coaching')).toBe('member');
    expect(classifyRoute('/administration')).toBe('member');
    expect(classifyRoute('/gymnastics')).toBe('member');
  });

  it('never classifies a privileged area as public', () => {
    for (const p of ['/coach', '/gym', '/admin', '/admin/users']) {
      expect(isPublicPath(p), p).toBe(false);
      expect(requiresSession(p), p).toBe(true);
    }
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
