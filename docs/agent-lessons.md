# Project lessons

## 2026-11-02: Check redirects after URL normalization

- **Failure:** `/a/..//evil.example` passed the raw same-site check but normalized into a protocol-relative path, causing an off-site auth redirect.
- **Rule:** Validate the normalized pathname as well as the original input. Check the final redirect destination in route tests, including encoded dot segments.
- **Verified:** Regression tests reproduced the external redirect before the fix and pass after it.

## 2026-11-02: Authorize cascading effects at the parent

- **Failure:** Deleting a custom role bypassed child-table RLS and removed permissions and assignments that the caller could not revoke directly.
- **Rule:** Include cascading effects when checking parent DELETE permissions. Preserve deployed migrations by adding a forward migration, and update rollback dependency order when a policy references another table.
- **Verified:** Restricted deletion, authorized deletion, and rollback/re-apply tests pass.
