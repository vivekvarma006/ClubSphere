# Authorization model

## Concepts

| Concept | Stored in | Grants |
|---|---|---|
| **Identity** | `auth.users` (Supabase Auth) → `profiles` | Nothing by itself. A signed-in user with no memberships can only see active clubs, their own profile and their own requests. |
| **Membership** | `organization_memberships` (`active` / `suspended`) | Being "in" one organization. Suspended memberships grant nothing. |
| **Role** | `organization_roles`, one set **per organization** | A named bundle of permissions inside that organization only. |
| **Permission** | `permissions` (global catalog) via `role_permissions` | One capability, e.g. `membership.review`. Code checks these, never role names. |
| **Platform admin** | `platform_admins` | Create organizations, change organization status, read all audit logs. **No** authority inside any organization. |

Effective permissions in organization *O* for user *U* are the union of permissions of all roles on U's membership in O, **only if** the membership is `active` **and** O is `active`. Otherwise the set is empty. This is `private.my_org_permissions(O)`.

Membership in organization A never affects anything in organization B: every check takes the organization id from the row being acted on.

## Permission catalog (Phase 1)

| Permission | Allows | Owner | Officer | Member |
|---|---|:-:|:-:|:-:|
| `org.settings.manage` | Edit name, branding, onboarding policy, email domains, profile questions | ✅ | | |
| `member.read` | See member list and profiles of members/applicants | ✅ | ✅ | |
| `membership.review` | Approve / reject requests | ✅ | ✅ | |
| `membership.suspend` | Suspend / reinstate members | ✅ | ✅ | |
| `role.assign` | Give / remove roles on members | ✅ | | |
| `role.manage` | Create custom roles, change role permissions | ✅ | | |
| `audit.read` | Read the organization's audit log | ✅ | | |
| `analytics.read` | View reports | ✅ | ✅ | |

These are the **defaults seeded for every new organization**. An owner can change officer/member permissions or create custom roles, within the escalation rule below.

## Escalation rules (enforced in the database)

1. **Subset rule.** You can only assign/revoke a role, grant/remove a role permission, or suspend/reinstate a member if you hold *every* permission involved yourself. Privilege can flow down, never up.
2. **Owner role is fixed.** Its permissions cannot be edited through the API (`role_permissions` RLS).
3. **At least one active owner.** Revoking the owner role or suspending an owner fails if no other active owner would remain. Operations lock the organization row first, so two owners cannot remove each other at the same moment.
4. **No self-service authority.** Nobody can suspend/reinstate themselves or review their own request. Sign-up never creates memberships or roles.
5. **No direct writes.** API roles have no INSERT/UPDATE/DELETE privileges on membership tables or the audit log; `is_system`, `is_default`, `slug` and `status` columns are not writable.

## Authorization matrix

Legend: ✅ allowed · ❌ denied · *own* only their own rows · *—* not applicable. **Enforced by** names the layer that would still stop the action if the application check were removed.

| Operation | Signed out | Signed in, no membership | Member | Officer | Owner | Platform admin (no org role) | Enforced by |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| List active organizations | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | GRANT (anon none), RLS `organizations_select` |
| Read own profile / edit display name | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | RLS `profiles_*`, column GRANT |
| Read another user's profile | ❌ | ❌ | ❌ | if member/applicant of their org | same | ❌ | RLS via `can_view_profile` |
| Request membership | ❌ | ✅ verified email, eligible domain, policy open | ❌ already member | — | — | ✅ like anyone | `request_membership` |
| See own requests / memberships | ❌ | *own* | *own* | *own* | *own* | *own* | RLS |
| See the review queue | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | RLS `membership_requests_select` + service check |
| Approve / reject a request | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | `approve/reject_membership_request` |
| Withdraw a pending request | ❌ | *own* | — | ❌ others' | ❌ others' | ❌ | `withdraw_membership_request` |
| See the member list | ❌ | ❌ | *own row* | ✅ | ✅ | ❌ | RLS `organization_memberships_select` |
| Suspend / reinstate a member | ❌ | ❌ | ❌ | ✅ (not owners, not self) | ✅ (not self, not last owner) | ❌ | `suspend/reinstate_membership` |
| Assign / revoke roles | ❌ | ❌ | ❌ | ❌ | ✅ (subset rule, last owner) | ❌ | `assign_role` / `revoke_role` |
| Create custom role / edit role permissions | ❌ | ❌ | ❌ | ❌ | ✅ (not owner role, subset rule) | ❌ | RLS `organization_roles_*`, `role_permissions_*` |
| Edit organization settings | ❌ | ❌ | ❌ | ❌ | ✅ (not slug/status) | ❌ | RLS + column GRANT |
| Read organization audit log | ❌ | ❌ | ❌ | ❌ | ✅ own org | ✅ all orgs | RLS `audit_logs_select` |
| View reports | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | View filter `analytics.read` + RLS |
| Create organization | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | `create_organization` |
| Suspend / archive organization | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | `set_organization_status` |
| Write audit log / edit audit log | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | No GRANT + append-only triggers |

Every **❌** cell involving another organization is covered by a test: see `test/db/rls-isolation.test.ts`, `membership-flow.test.ts`, `suspension-and-roles.test.ts` and `test/integration/services.test.ts`. In particular, *crossUser* (officer in A, member in B) is shown to have officer rights only in A.

## Where checks happen

| Check | Application (`src/server`) | Database |
|---|---|---|
| Who is calling | `getClaims()` → `VerifiedActor` | `auth.uid()` from `request.jwt.claims`, set only by `withUserContext` |
| Which organization | Slug → `loadOrgAccess()` | Taken from the target row inside each procedure |
| Is the caller allowed | `assertPermission()` (clear error) | `has_org_permission()` in procedures and RLS (cannot be bypassed) |
| Does the target belong to that org | `assertBelongsToOrg()` | Composite FKs, RLS |
| Validity of input | Zod schemas | CHECK constraints, `validate_profile_answers()` |

## Privileged credentials

- **Service role key**: bypasses RLS. Not used by the application at all; reserved for one-off admin scripts.
- **`DATABASE_URL`** (server only): in production, a dedicated login role that can only `SET ROLE authenticated` (see [DEPLOYMENT.md](DEPLOYMENT.md#least-privilege-database-role)). If code ever forgot to switch role, that login role would have no table privileges and the query would fail closed.
