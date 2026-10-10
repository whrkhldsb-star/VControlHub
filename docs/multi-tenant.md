# Customer and account boundaries

VControlHub serves several customers from one platform. A customer is stored as a `Team` row; every tenant-owned record carries its `teamId`.

## Account types

- **Platform administrator** — holds the built-in `admin` role and belongs to no customer. It works across customers: the sidebar switcher selects one customer or "all customers", and lists follow that choice. Account administration, customers, identity templates, platform backups and announcements are platform-only.
- **Customer account** — belongs to exactly one customer through its `TeamMember` row (`team_members.userId` is unique). Its permissions are the base customer permissions (`team:read`, `user:read`) plus the permissions of the identity template on that membership. Account roles and direct grants do not apply to customer accounts.

Platform administrators create every account. Moving an account to another customer, or making it an administrator, drops its per-server and per-storage rows, which belonged to the old customer's resources.

## Identity templates

`IdentityTemplate` rows are global and maintained by platform administrators. Four built-ins (`identity:customer_admin`, `identity:operator`, `identity:viewer`, `identity:files`) are created by the migration and brought in line with the code by every seed run (each install and upgrade); administrators may add their own. Platform-only permissions (`PLATFORM_ONLY_PERMISSIONS` in `src/lib/auth/identity-templates.ts`) can never be part of a template. Template edits apply on the next request, because sessions and API-token authorization reload the membership and template from the database. A template that is still assigned cannot be deleted.

## Sessions and tokens

- A signed browser session carries its selected customer. A customer account always works in its own customer; an administrator's switch rotates only that browser's cookie, and `User.currentTeamId` is the preference for the next login.
- Each request reloads the account, its membership and the customer's `deletedAt`. Removing an account from its customer, or deleting the customer, removes access from existing cookies.
- API tokens bind to one customer when issued and stop working when the owner leaves that customer or the customer is deleted.

## Resource narrowing

Per-server rows (`UserServerAccess`) and per-storage path grants (`UserStorageAccess`) narrow a customer account. Without a row the account reaches all of its customer's servers, or all of a storage node, as far as its template allows. A row can independently restrict viewing, connecting, managing and file read/write/delete; storage grants are path allowlists with optional quota and maximum-file-size limits. A row with every flag cleared blocks that server or node. Rows never add a permission the template lacks. Administrators and holders of `storage:manage-node` are not narrowed by storage grants; bearer tokens remain limited to their explicit scopes.

## Servers: origin and transfer

`Server.origin` records whether the platform assigned a server (`PLATFORM`) or a customer account added it (`CUSTOMER`); `addedById` records who. Customer accounts may edit, enable/disable and delete only `CUSTOMER` servers of their own customer (`serverProfileTeamWhere`); platform servers are read-only to them whatever their template grants.

Administrators can move a server to another customer (`POST /api/servers/[id]/transfer`). Its storage node, metric history, quick services and VPS backups move with it; the old customer's per-server and per-storage rows are dropped. The transfer is refused while the old customer still has share links, image uploads, scheduled tasks, alert rules, playbooks, sync jobs, unfinished commands or downloads pointing at the server, so one customer's work never reaches into another's.

## Data boundary

Tenant-owned queries match the exact `teamId`. A null `teamId` is quarantined legacy data; only explicitly public built-in templates remain shared. Deleting a customer sets `Team.deletedAt`: its accounts lose access at once and its data stays scoped and unreachable until an administrator restores it. Local storage for a new customer lives under `STORAGE_ROOT/teams/<teamId>`.

Each customer has its own default storage node. Promoting a node changes defaults only inside that node's customer, including when a platform administrator performs the change.

Notifications keep their `teamId`. Administrators see the customer name on each notification, and opening one from another customer switches to that customer first.

## Migration from workspaces

Migration `20261011090000_customer_identity_templates` converts the earlier workspace model: administrators lose their memberships, an account in several workspaces keeps its oldest one, owners and workspace administrators become customer administrators, access roles map to the matching template (otherwise the account role decides, defaulting to read-only), the `__deleted__` slug tombstones become `deletedAt`, and workspace ownership, access roles, policy groups and account templates are removed together with the `team:create` and `team:member:manage` permissions.

## Verification before release

Run the unit tests, TypeScript, lint, i18n and API copy checks, the migration chain on a disposable PostgreSQL database, and the tenant boundary E2E suite. Review migration effects on a copy of the deployment database before deploying.
