# Remaining audit remediation (AUD-009–025)

These changes complete the local remediation for the remaining findings from the 2026-10-31 audit. Release acceptance also requires combined tests, production build, HTTP/browser verification, CI and deployment; a regression test passing alone is not deployment evidence.

## Authorization and execution

- **AUD-009**: filter indexed entries by readable node/path grants before pagination, directory derivation, counts and global index statistics. A readable descendant permits ancestor traversal without synchronizing or exposing its unreadable siblings.
- **AUD-010**: WebDAV retains only the intersection of the token's and current owner's storage read/write/delete permissions. COPY and MOVE work with compound permissions without inheriting platform-admin roles.
- **AUD-011**: MOVE checks total incoming bytes and largest individual file against the destination grant, accounts for moves already inside the grant, and releases admission locks on every outcome.
- **AUD-012**: queued and existing sync jobs revalidate the current actor and both node-root/path-grant boundaries before execution. A file-only account does not inherit arbitrary server SSH reach from an old job definition.
- **AUD-013**: exhausting the bounded stale-Agent-job sweep never makes the next expired job eligible. The claim CAS also includes the timestamp and timeout predicate.
- **AUD-014**: customer AI traffic summaries query visible server IDs only. Hub-wide rows remain available only in the platform administrator's all-customers view.
- **AUD-015**: Playbook runs, including notification/webhook-only runs, revalidate the creator's current account, customer and run permission before execution and dispatch.
- **AUD-016**: a failed durable running-marker CAS prevents side effects. Workers pass lease cancellation into the executor and webhook transport; lease loss is not a normal step retry or progress write. An already-started external request cannot be rolled back by cancellation, so durable dispatch markers remain necessary.

## Media, customers and images

- **AUD-017**: WebDAV media playback/download uses the existing encrypted-credential, URL-validated streaming adapter. Full, byte-range, invalid-range and empty-body responses use the same stream headers as local/SFTP media. The browser-facing list does not receive encrypted credentials.
- **AUD-018**: customer creation locks the submitted draft and cancel toggle until the request finishes; an earlier response cannot erase edits entered during submission.
- **AUD-019**: private-image ownership alone is insufficient after customer transfer. List, stats, batch, file read and deletion also require the current customer boundary. Explicit public-image access and all-customers administrator access retain their separate contracts; deleted-customer image bytes are not served.

## Backups, capacity and content preservation

- **AUD-020**: scheduled VPS backups retain the creator on both the backup record and job. Execution refuses disabled/missing owners, deleted customers and inaccessible/disabled servers before SSH dispatch. Legacy ownerless queued records fail closed rather than running as an implicit system administrator.
- **AUD-021**: the first VPS-backup heartbeat renews the same lease duration used for claiming and checks that renewal succeeded.
- **AUD-022**: restoring recycled content checks its revived bytes and largest file against current capacity, while retaining the existing delete/restore authorization contract. Directory batches are admitted before any row is revived and committed transactionally.
- **AUD-023**: quota admission is serialized by storage node, not grant ID. Different users/grants whose directory usage overlaps cannot simultaneously admit stale capacity. Quotas remain the initiating grant's policy, not an administrative node-wide hard limit.
- **AUD-024**: resumable and single-request uploads refuse a destination held by recycled content instead of silently destroying its recoverable bytes.
- **AUD-025**: upload, editor, version restore, file COPY and WebDAV overwrite paths share the content lock across snapshot, promotion and metadata writes. Quota locks precede content locks. A blocked stale editor returns a conflict instead of acknowledging content that another writer subsequently loses.

## Evidence boundaries

New regressions live beside their owning modules, including real disposable-PostgreSQL/filesystem upload and restore tests. Those tests require `RUN_DATABASE_INTEGRATION_TESTS=1` and refuse non-loopback/non-test database targets. Backup revocation tests use real database/job/service code but stop at a mocked SSH boundary; lease-duration tests use fake time. WebDAV adapter tests use real loopback HTTP behind the explicit transport test seam, not an external WebDAV provider. The isolated HTTP audit spec is opt-in via `AUDIT_REMEDIATION_ISOLATED=1` and guards its dedicated database/app endpoints.

Original failing observations, RED/GREEN outputs and release-gate receipts are retained outside the repository under the audit evidence directory. They contain environment-specific details and are not production fixtures.
