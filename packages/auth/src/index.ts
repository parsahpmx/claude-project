/**
 * @meter402/auth
 *
 * Roles, permissions, principals, and the rules that decide whether an actor
 * may do a thing. Pure logic with no I/O, so every branch is unit-testable and
 * the same evaluation runs in the API, the future dashboard, and the admin
 * console rather than being reimplemented per surface.
 */

export * from './permissions.js';
export * from './roles.js';
export * from './principal.js';
export * from './scopes.js';
export * from './authorization.js';
export * from './owner-invariants.js';
