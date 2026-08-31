import { newId } from '@meter402/shared';
import { auditEvents } from '@meter402/database';
import type { Executor } from '../../lib/executor.js';

/**
 * Audit events.
 *
 * Append-only by design: this module exposes `record` and nothing else. There
 * is no update or delete, because an audit log an attacker can edit after the
 * fact is not an audit log.
 *
 * Written with the same executor as the change it describes, so an audit entry
 * cannot survive a rolled-back transaction and a committed change cannot lose
 * its entry.
 */

export type AuditAction =
  | 'organization.created'
  | 'organization.updated'
  | 'member.added'
  | 'member.role_changed'
  | 'member.removed'
  | 'project.created'
  | 'project.updated'
  | 'project.archived'
  | 'api_key.created'
  | 'api_key.rotated'
  | 'api_key.revoked';

export interface AuditEventInput {
  readonly organizationId: string;
  readonly actorType: 'user' | 'api_key' | 'system';
  readonly actorId: string | null;
  readonly action: AuditAction;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly requestId?: string | null;
  /**
   * Caller-supplied context. Must never contain a plaintext API key secret or
   * any other credential — the audit log is widely readable within an
   * organization, so it is the wrong place for anything sensitive. The API-key
   * service constructs this metadata explicitly for that reason rather than
   * spreading a record that might carry a secret.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export async function recordAuditEvent(executor: Executor, input: AuditEventInput): Promise<void> {
  await executor.insert(auditEvents).values({
    id: newId('auditEvent'),
    organizationId: input.organizationId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    requestId: input.requestId ?? null,
    metadata: input.metadata ?? {},
  });
}
