import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Meter402Error } from '@meter402/shared';
import { requirePermission } from '@meter402/auth';
import { requireUserPrincipal, resolveOrganizationAccess } from '../../auth/authenticate.js';
import { actorContext, getPrincipal, type RouteDeps } from '../context.js';
import {
  createProject,
  findProjectInOrganization,
  findProjectOrganizationId,
  listProjectsInOrganization,
  updateProject,
  type ProjectRecord,
} from '../../modules/projects/project.repository.js';
import { recordAuditEvent } from '../../modules/audit/audit.repository.js';
import { isUniqueViolation } from '../../modules/identity/organization.service.js';
import { assertValidSlug, slugify } from '../../lib/slug.js';
import {
  parseBody,
  parseParams,
  parseQuery,
  settlementAddressSchema,
} from '../../lib/validation.js';
import type { TenantScope } from '../../lib/tenant.js';
import type { AuthorizationContext } from '@meter402/auth';
import type { Database } from '@meter402/database';
import type { UserPrincipal } from '@meter402/auth';

const createProjectSchema = z.object({
  organizationId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(2).max(48).optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    settlementAddress: settlementAddressSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'No fields to update' });

const listQuerySchema = z.object({
  organizationId: z.string().min(1).max(64),
  includeArchived: z.enum(['true', 'false']).optional(),
});

const projectParams = z.object({ projectId: z.string().min(1).max(64) });

function serializeProject(record: ProjectRecord) {
  return {
    id: record.id,
    organizationId: record.organizationId,
    name: record.name,
    slug: record.slug,
    description: record.description,
    status: record.status,
    liveModeEnabled: record.liveModeEnabled,
    settlementAddress: record.settlementAddress,
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * Resolve `/v1/projects/:projectId` to a scope the caller is entitled to.
 *
 * Two steps, and the order matters. First find which organization owns the
 * project — a lookup that returns only an opaque organization ID and no
 * project data. Then run the normal membership check against it.
 *
 * The result is that a caller probing another tenant's project ID gets exactly
 * the same 404 as for a project that never existed: the first step's value
 * never reaches them, and the second step refuses. This is what lets project
 * routes be addressed by ID alone without weakening isolation.
 */
export async function resolveProjectAccess(
  db: Database,
  principal: UserPrincipal,
  projectId: string,
): Promise<{ context: AuthorizationContext; scope: TenantScope; project: ProjectRecord }> {
  const organizationId = await findProjectOrganizationId(db, projectId);
  if (!organizationId) {
    throw new Meter402Error('PROJECT_NOT_FOUND');
  }

  let access;
  try {
    access = await resolveOrganizationAccess(db, principal, organizationId);
  } catch (error) {
    // A non-member must not be able to tell "someone else's project" from
    // "no such project", so the organization-level 404 is re-labelled rather
    // than surfaced as ORGANIZATION_NOT_FOUND for a /projects/ URL.
    if (error instanceof Meter402Error && error.code === 'ORGANIZATION_NOT_FOUND') {
      throw new Meter402Error('PROJECT_NOT_FOUND');
    }
    throw error;
  }

  const project = await findProjectInOrganization(db, access.scope, projectId);
  /* istanbul ignore next -- the organization came from this project. */
  if (!project) {
    throw new Meter402Error('PROJECT_NOT_FOUND');
  }

  return { ...access, project };
}

export function registerProjectRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post('/v1/projects', async (request, reply) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const body = parseBody(createProjectSchema, request.body);

    /*
     * The organization ID arrives in the body, and is therefore untrusted
     * until this call proves membership (product rule 9). What comes back is a
     * scope derived from the membership row, and that is what the insert uses
     * — so naming someone else's organization here yields 404, not a project
     * in their account.
     */
    const { context, scope } = await resolveOrganizationAccess(
      deps.db,
      principal,
      body.organizationId,
    );
    requirePermission(context, 'projects:create');

    const slug = body.slug?.trim() ? body.slug.trim() : slugify(body.name);
    assertValidSlug(slug);

    try {
      const project = await deps.db.transaction(async (tx) => {
        const created = await createProject(tx, scope, {
          name: body.name,
          slug,
          description: body.description ?? null,
        });
        await recordAuditEvent(tx, {
          ...actorContext(request, principal.userId),
          organizationId: scope.organizationId,
          actorType: 'user',
          actorId: principal.userId,
          action: 'project.created',
          resourceType: 'project',
          resourceId: created.id,
          metadata: { slug, name: created.name },
        });
        return created;
      });

      void reply.status(201);
      return { data: serializeProject(project) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new Meter402Error(
          'CONFLICT',
          `A project with the slug "${slug}" already exists in this organization.`,
        );
      }
      throw error;
    }
  });

  app.get('/v1/projects', async (request) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const query = parseQuery(listQuerySchema, request.query);

    const { context, scope } = await resolveOrganizationAccess(
      deps.db,
      principal,
      query.organizationId,
    );
    requirePermission(context, 'projects:read');

    const projects = await listProjectsInOrganization(deps.db, scope, {
      includeArchived: query.includeArchived === 'true',
    });

    return { data: projects.map(serializeProject), hasMore: false, nextCursor: null };
  });

  app.get('/v1/projects/:projectId', async (request) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const { projectId } = parseParams(projectParams, request.params);

    const { context, project } = await resolveProjectAccess(deps.db, principal, projectId);
    requirePermission(context, 'projects:read');

    return { data: serializeProject(project) };
  });

  app.patch('/v1/projects/:projectId', async (request) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const { projectId } = parseParams(projectParams, request.params);
    const body = parseBody(updateProjectSchema, request.body);

    const { context, scope } = await resolveProjectAccess(deps.db, principal, projectId);
    requirePermission(context, 'projects:update');

    const updated = await deps.db.transaction(async (tx) => {
      const project = await updateProject(tx, scope, projectId, body);
      /* istanbul ignore next -- access was just resolved. */
      if (!project) {
        throw new Meter402Error('PROJECT_NOT_FOUND');
      }
      await recordAuditEvent(tx, {
        ...actorContext(request, principal.userId),
        organizationId: scope.organizationId,
        actorType: 'user',
        actorId: principal.userId,
        action: 'project.updated',
        resourceType: 'project',
        resourceId: projectId,
        metadata: { fields: Object.keys(body) },
      });
      return project;
    });

    return { data: serializeProject(updated) };
  });

  /**
   * Archive rather than delete.
   *
   * A project owns payments, receipts, and audit history. Deleting the row
   * would either orphan or cascade away financial records, so DELETE moves the
   * project to ARCHIVED — it stops accepting work and disappears from the
   * default listing, and everything it produced remains reconcilable.
   */
  app.delete('/v1/projects/:projectId', async (request) => {
    const principal = requireUserPrincipal(getPrincipal(request));
    const { projectId } = parseParams(projectParams, request.params);

    const { context, scope } = await resolveProjectAccess(deps.db, principal, projectId);
    requirePermission(context, 'projects:delete');

    const archived = await deps.db.transaction(async (tx) => {
      const project = await updateProject(tx, scope, projectId, { status: 'ARCHIVED' });
      /* istanbul ignore next */
      if (!project) {
        throw new Meter402Error('PROJECT_NOT_FOUND');
      }
      await recordAuditEvent(tx, {
        ...actorContext(request, principal.userId),
        organizationId: scope.organizationId,
        actorType: 'user',
        actorId: principal.userId,
        action: 'project.archived',
        resourceType: 'project',
        resourceId: projectId,
        metadata: {},
      });
      return project;
    });

    return { data: serializeProject(archived) };
  });
}
