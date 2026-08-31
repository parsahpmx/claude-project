import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Meter402Error } from '@meter402/shared';
import { isRole, requirePermission, type Role } from '@meter402/auth';
import { requireUserPrincipal, resolveOrganizationAccess } from '../../auth/authenticate.js';
import { actorContext, getPrincipal, type RouteDeps } from '../context.js';
import {
  findOrganization,
  listOrganizationsForUser,
  updateOrganization,
  type OrganizationRecord,
} from '../../modules/identity/organization.repository.js';
import { createOrganizationWithOwner } from '../../modules/identity/organization.service.js';
import { changeMembership, inviteMember } from '../../modules/identity/membership.service.js';
import { listMemberships } from '../../modules/identity/membership.repository.js';
import { parseBody, parseParams, settlementAddressSchema } from '../../lib/validation.js';

const roleSchema = z.string().refine(isRole, { message: 'Unknown role' });

const createOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(2).max(48).optional(),
});

const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    settlementAddress: settlementAddressSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'No fields to update' });

const inviteMemberSchema = z.object({
  email: z.string().trim().email().max(320),
  role: roleSchema,
});

const updateMemberSchema = z
  .object({
    role: roleSchema.optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: 'Provide a role or a status',
  });

const organizationParams = z.object({ organizationId: z.string().min(1).max(64) });
const memberParams = organizationParams.extend({ membershipId: z.string().min(1).max(64) });

function serializeOrganization(record: OrganizationRecord, role?: Role) {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    status: record.status,
    plan: record.plan,
    settlementAddress: record.settlementAddress,
    createdAt: record.createdAt.toISOString(),
    ...(role ? { role } : {}),
  };
}

export function registerOrganizationRoutes(app: FastifyInstance, deps: RouteDeps): void {
  /**
   * Create an organization.
   *
   * The only route that does not require an existing membership — a user with
   * no organizations has to be able to make their first one. The creator
   * becomes OWNER in the same transaction.
   */
  app.post('/v1/organizations', async (request, reply) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const body = parseBody(createOrganizationSchema, request.body);

    const { organization, membership } = await createOrganizationWithOwner(deps.db, {
      userId: principal.userId,
      name: body.name,
      slug: body.slug,
      requestId: String(request.id),
      ipAddress: request.ip,
      userAgent: (request.headers['user-agent'] ?? null)?.slice(0, 256) ?? null,
    });

    void reply.status(201);
    return { data: serializeOrganization(organization, membership.role) };
  });

  /** Only organizations the caller actively belongs to. */
  app.get('/v1/organizations', async (request) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const rows = await listOrganizationsForUser(deps.db, principal.userId);
    return {
      data: rows.map((row) => serializeOrganization(row, row.role)),
      hasMore: false,
      nextCursor: null,
    };
  });

  app.get('/v1/organizations/:organizationId', async (request) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const { organizationId } = parseParams(organizationParams, request.params);

    // Membership is checked here; a non-member gets 404, never 403.
    const { context, scope } = await resolveOrganizationAccess(deps.db, principal, organizationId);
    requirePermission(context, 'organization:read');

    const organization = await findOrganization(deps.db, scope);
    if (!organization) {
      throw new Meter402Error('ORGANIZATION_NOT_FOUND');
    }
    return { data: serializeOrganization(organization, context.role) };
  });

  app.patch('/v1/organizations/:organizationId', async (request) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const { organizationId } = parseParams(organizationParams, request.params);
    const body = parseBody(updateOrganizationSchema, request.body);

    const { context, scope } = await resolveOrganizationAccess(deps.db, principal, organizationId);
    requirePermission(context, 'organization:update');

    const updated = await updateOrganization(deps.db, scope, body);
    if (!updated) {
      throw new Meter402Error('ORGANIZATION_NOT_FOUND');
    }
    return { data: serializeOrganization(updated, context.role) };
  });

  app.get('/v1/organizations/:organizationId/members', async (request) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const { organizationId } = parseParams(organizationParams, request.params);

    const { context, scope } = await resolveOrganizationAccess(deps.db, principal, organizationId);
    requirePermission(context, 'members:read');

    const members = await listMemberships(deps.db, scope);
    return {
      data: members.map((member) => ({
        id: member.membershipId,
        userId: member.userId,
        role: member.role,
        status: member.status,
      })),
      hasMore: false,
      nextCursor: null,
    };
  });

  app.post('/v1/organizations/:organizationId/members', async (request, reply) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const { organizationId } = parseParams(organizationParams, request.params);
    const body = parseBody(inviteMemberSchema, request.body);

    const { context, scope } = await resolveOrganizationAccess(deps.db, principal, organizationId);
    requirePermission(context, 'members:invite');

    /*
     * Inviting someone as OWNER is a promotion, not an invitation, so it
     * requires the authority to change roles as well. Without this an ADMIN
     * could mint an OWNER and then have that account act on their behalf.
     */
    if (body.role === 'OWNER') {
      requirePermission(context, 'members:update_role');
    }

    const membership = await inviteMember(deps.db, scope, actorContext(request, principal.userId), {
      email: body.email,
      role: body.role as Role,
    });

    void reply.status(201);
    return {
      data: {
        id: membership.membershipId,
        userId: membership.userId,
        role: membership.role,
        status: membership.status,
      },
    };
  });

  app.patch('/v1/organizations/:organizationId/members/:membershipId', async (request) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const { organizationId, membershipId } = parseParams(memberParams, request.params);
    const body = parseBody(updateMemberSchema, request.body);

    const { context, scope } = await resolveOrganizationAccess(deps.db, principal, organizationId);
    requirePermission(context, 'members:update_role');

    const membership = await changeMembership(
      deps.db,
      scope,
      actorContext(request, principal.userId),
      {
        membershipId,
        ...(body.role ? { role: body.role as Role } : {}),
        ...(body.status ? { status: body.status } : {}),
      },
    );

    return {
      data: {
        id: membership.membershipId,
        userId: membership.userId,
        role: membership.role,
        status: membership.status,
      },
    };
  });

  /**
   * Remove a member.
   *
   * A soft removal: the row moves to REMOVED rather than being deleted, so the
   * audit trail and any re-invitation reuse the same membership. The owner
   * invariant is enforced inside the transaction, so removing the last owner
   * fails.
   */
  app.delete('/v1/organizations/:organizationId/members/:membershipId', async (request) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const { organizationId, membershipId } = parseParams(memberParams, request.params);

    const { context, scope } = await resolveOrganizationAccess(deps.db, principal, organizationId);
    requirePermission(context, 'members:remove');

    const membership = await changeMembership(
      deps.db,
      scope,
      actorContext(request, principal.userId),
      { membershipId, status: 'REMOVED' },
    );

    return {
      data: { id: membership.membershipId, status: membership.status },
    };
  });
}
