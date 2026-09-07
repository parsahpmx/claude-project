# Audit log — design, not yet implemented

**Status: DESIGN ONLY. No audit log exists.**

Full audit logging is P3 and there is nothing yet worth auditing — no role
changes, no memberships, no refunds, because none of those surfaces are built.
Writing the table now would produce an empty table nobody reads and a schema
guessed against features that do not exist.

But the authorization model landed this phase, and it is the thing audit logging
attaches to. So this records the design while the decisions are fresh, so that
the phase which needs it does not have to re-derive them — and so that the
authorization model can be checked now for whether it leaves room.

## What must be auditable

Anything where the answer to "who did this to my account?" must not be "we don't
know". That is a narrower set than "everything", deliberately: an audit log that
records every read is a log nobody can search.

| Event | Why it matters |
|---|---|
| `role.granted` / `role.revoked` | Privilege change. The single most important one. |
| `platform_role.granted` / `platform_role.revoked` | Platform escalation, currently service-role only |
| `organization.member.added` / `.removed` | Who can see a gym's members |
| `coach_client.proposed` / `.accepted` / `.ended` | Who can see an athlete's data |
| `access.override` | Someone was let through a door manually (Phase 10) |
| `membership.changed` | Entitlement, and therefore door access (Phase 9) |
| `user.suspended` / `.reinstated` | Account state |
| `refund.issued` | Money (Phase 12) |
| `data.exported` | Bulk read of personal data |

Deliberately **not** audited: ordinary reads, activity creation, a person
editing their own profile. Those are the normal use of the product, they are
already governed by RLS, and logging them buries the nine rows above.

## Shape

```sql
create table public.audit_events (
  id              bigint generated always as identity primary key,
  occurred_at     timestamptz not null default now(),

  -- Who acted. Nullable because some acts are the system's.
  actor_id        uuid references public.profiles (id) on delete set null,
  actor_role      text,               -- the role relied on, as a string snapshot

  action          text not null,      -- 'role.granted'
  -- What was acted on, as a type + id pair rather than a dozen nullable FKs.
  subject_type    text not null,      -- 'organization_member'
  subject_id      text not null,

  organization_id uuid references public.organizations (id) on delete set null,
  metadata        jsonb not null default '{}',

  request_id      text                -- correlates with application logs
);
```

Three decisions worth keeping:

**Snapshot the role as text, do not join to it.** The point of an audit row is
what was true when it happened. If `actor_role` is a foreign key and the role is
later renamed or revoked, the history silently changes to something that did not
happen.

**`on delete set null`, never cascade.** Deleting a user must not erase the
record of what they did — that is exactly when the log matters most. The row
survives with a null actor and the metadata still names them.

**No FK on `subject_id`.** Subjects span many tables and some will be deleted.
A polymorphic text pair keeps the log append-only and independent of the
lifecycle of what it describes.

## Who may read it

`platform.audit.read` — already defined in the permission model, already granted
to `platform_admin` and `super_admin` and to nobody else. Wiring it up is a
policy and a page, not a new concept, which is the point of designing it now.

RLS shape when the table lands:

```sql
alter table public.audit_events enable row level security;

create policy audit_read on public.audit_events
  for select using (private.is_platform_admin());

-- No insert, update or delete policy at all. Writes happen through a
-- SECURITY DEFINER function or the service role, so that nothing reachable
-- from a browser can forge, alter or remove an entry. The same shape as
-- platform_role_assignments, and for the same reason.
```

**Immutability is the property that makes it worth having.** A log ordinary
staff can edit is a log that proves nothing. No `update` policy, no `delete`
policy, ever — retention is a scheduled job running as the service role, not a
delete button.

## What must not go in it

- Passwords, tokens, session identifiers, QR credential payloads.
- Health data, GPS coordinates, message contents.
- Anything that would make the log itself a breach if it leaked.

Record **that** a thing happened and to which subject; never a copy of the
sensitive thing. `metadata` is for `{"from": "gym_staff", "to": "gym_manager"}`,
not for the row that changed.

## Implementation order, when its phase arrives

1. Table, RLS, and a `private.record_audit_event(...)` SECURITY DEFINER writer.
2. Call it from the role-granting and membership paths — the ones that exist.
3. `/admin/audit`, gated on `platform.audit.read`.
4. Extend as access control, memberships and payments land, one event at a time.

Do not build steps 3 and 4 before the events exist. An audit page with nothing
in it teaches people the log is empty, and they stop looking.
