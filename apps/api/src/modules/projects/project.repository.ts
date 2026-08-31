import { and, desc, eq, ne } from 'drizzle-orm';
import { newId } from '@meter402/shared';
import { projects } from '@meter402/database';
import type { Executor } from '../../lib/executor.js';
import type { TenantScope } from '../../lib/tenant.js';

/**
 * Projects.
 *
 * Every function here takes a `TenantScope` and includes `organization_id` in
 * its WHERE clause. There is no `findProjectById(id)`: the narrowest lookup
 * available is "this project, within this organization", so a leaked or
 * guessed project ID from another tenant simply returns nothing.
 */

export type ProjectStatus = 'ACTIVE' | 'ARCHIVED' | 'SUSPENDED';

export interface ProjectRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly status: ProjectStatus;
  readonly liveModeEnabled: boolean;
  readonly createdAt: Date;
}

const PROJECT_COLUMNS = {
  id: projects.id,
  organizationId: projects.organizationId,
  name: projects.name,
  slug: projects.slug,
  description: projects.description,
  status: projects.status,
  liveModeEnabled: projects.liveModeEnabled,
  createdAt: projects.createdAt,
} as const;

export async function createProject(
  executor: Executor,
  scope: TenantScope,
  input: { name: string; slug: string; description?: string | null },
): Promise<ProjectRecord> {
  const [row] = await executor
    .insert(projects)
    .values({
      id: newId('project'),
      // Taken from the scope, never from the request body. A caller cannot
      // create a project inside someone else's organization by naming it.
      organizationId: scope.organizationId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
    })
    .returning(PROJECT_COLUMNS);

  /* istanbul ignore next */
  if (!row) {
    throw new Error('Project insert returned no row');
  }
  return row;
}

export async function findProjectInOrganization(
  executor: Executor,
  scope: TenantScope,
  projectId: string,
): Promise<ProjectRecord | null> {
  const [row] = await executor
    .select(PROJECT_COLUMNS)
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, scope.organizationId)))
    .limit(1);

  return row ?? null;
}

export async function listProjectsInOrganization(
  executor: Executor,
  scope: TenantScope,
  options: { includeArchived?: boolean } = {},
): Promise<readonly ProjectRecord[]> {
  const conditions = [eq(projects.organizationId, scope.organizationId)];
  if (options.includeArchived !== true) {
    conditions.push(ne(projects.status, 'ARCHIVED'));
  }

  return executor
    .select(PROJECT_COLUMNS)
    .from(projects)
    .where(and(...conditions))
    .orderBy(desc(projects.createdAt));
}

export async function updateProject(
  executor: Executor,
  scope: TenantScope,
  projectId: string,
  patch: { name?: string; description?: string | null; status?: ProjectStatus },
): Promise<ProjectRecord | null> {
  const [row] = await executor
    .update(projects)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, scope.organizationId)))
    .returning(PROJECT_COLUMNS);

  return row ?? null;
}

/**
 * Resolve which organization a project belongs to — and nothing else.
 *
 * This is the one deliberately unscoped read in the project module, and it
 * exists so that routes can be `/v1/projects/:projectId` rather than forcing
 * every caller to also name the organization.
 *
 * It is safe because of what it does *not* return: only an opaque organization
 * ID, never project data. The caller must immediately pass that ID through
 * `resolveOrganizationAccess`, which returns 404 unless the user holds a
 * membership. So a caller probing another tenant's project ID learns nothing —
 * the value never reaches them, and the response is identical to a project
 * that does not exist.
 *
 * Any change that makes this return more than the organization ID needs a
 * second look: the narrowness is the security property.
 */
export async function findProjectOrganizationId(
  executor: Executor,
  projectId: string,
): Promise<string | null> {
  const [row] = await executor
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  return row?.organizationId ?? null;
}
