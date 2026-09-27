# Workspace and account boundaries

## Identity and workspace selection

- A user account is global. Its built-in roles and direct grants form an upper bound for what that account can do.
- A signed browser session carries its selected workspace. Switching workspaces rotates only that browser's cookie; `User.currentTeamId` is a preference for the next login. Platform administrators may select any live workspace without joining it; ordinary users need an active membership.
- Each request reloads account roles, grants, and active membership. Removing a member immediately removes access from existing cookies.
- API tokens bind to one workspace when issued. Tokens issued before this rule are revoked by the migration because their original workspace cannot be reconstructed safely. Removing membership or deleting the workspace invalidates a bound token.

## Membership permissions

`TeamMember.role` controls membership administration (`owner`, `admin`, `member`). `TeamMember.accessRole` narrows resource permissions within that workspace (`inherit`, `operator`, `viewer`, `storage_manager`). Existing members start at `inherit`; owners and workspace admins can manage members. An access role never grants a permission absent from the account's upper bound. Platform administrators use the built-in `admin` account role and may inspect all workspaces.

The current owner or a platform administrator can transfer ownership to another active workspace member. The previous owner remains a workspace administrator. Membership removal and ownership transfer share a workspace lock so the last owner cannot be removed during a transfer.

Global credentials, account roles, role templates, platform announcements, and whole-platform database/file backups require the built-in platform administrator role. Workspace owners manage their own membership through the team API. Tenant resource creation requires an active workspace.

## Data boundary and migration

Tenant-owned queries match the exact `teamId`. A null `teamId` is quarantined legacy data; only explicitly public built-in templates remain shared. Deleting a workspace leaves a tombstone so foreign keys preserve historical ownership. Local storage created for a new workspace lives under `STORAGE_ROOT/teams/<teamId>`; existing local paths are preserved during re-seeding to avoid losing access to historical files.

Each workspace has its own default storage node. Promoting a node changes defaults only inside that node's workspace, including when a platform administrator performs the change.

The migration creates a default workspace for an old installation with users but no live workspace. If exactly one historical live workspace exists, it assigns unowned legacy rows to that workspace. With multiple workspaces, ambiguous null-team rows remain quarantined for manual ownership review. Check those rows before making them available to a tenant. Revoked API tokens must be reissued from the intended workspace.

## Verification before release

Run the unit tests, TypeScript, lint, i18n and API copy checks, migration checks on a disposable PostgreSQL database, and the tenant boundary E2E suite. Review migration effects on a copy of the deployment database before deploying.
