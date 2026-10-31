# Authentication/import audit remediation

Scope: AUD-001–008 from the 2026-10-31 audit. Other findings remain open.

- TOTP consumption is an atomic database update of `User.lastAcceptedTotpStep`, conditional on the stored seed and enabled account. A nullable additive migration must run before deploying this code. Do not export/restore the consumed-step column.
- Password reset changes the password and forces a change without rewriting account status; concurrent disable is retained. It also increments the session epoch.
- New passwords use `vch-bcrypt-sha256-v1:` plus bcrypt(cost 12) over a domain-separated SHA-256 Base64 digest, so all UTF-8 bytes are significant. Old bcrypt hashes still verify and are CAS-upgraded after a successful login. A submitted legacy password of at least 72 bytes requires a password change: the old hash cannot establish its suffix. Previously discarded suffixes cannot be recovered; resetting the password is the only way to establish a new unambiguous credential. Old sessions are invalidated when their password fingerprint changes.
- Credential-bearing user imports increment the local session epoch. Full imports can explicitly clear 2FA; standard/older redacted packages preserve the target factor. Source session epochs are never imported.
- Newly generated recovery codes store encrypted, versioned one-way fingerprints (`v2:`), using the same ENCRYPTION_KEY required by the TOTP seed. They no longer depend on AUTH_SESSION_SECRET. Existing HMAC fingerprints still verify with their original signing key. Regenerate recovery codes before migrating an old package, or sign in via TOTP and regenerate after import. Import preview warns about legacy codes and checks TOTP/recovery/settings encryption; do not overwrite a running target's keys simply to migrate credentials.
- Customer lists read all bounded database pages instead of silently truncating at 500. The API remains a complete list for the manager and switcher; this is not a new paginated UI.
- Server-rendered authentication converts only AuthError to unauthenticated; database failures propagate to the error boundary rather than redirecting to login.

Regression evidence includes disposable PostgreSQL concurrent TOTP attempts, module reload replay, secret rotation, reset/disable interleaving, imported session revocation and full/standard 2FA semantics; unit tests cover full-length passwords and legacy compatibility, recovery-key migration, complete customer lists and SSR failure propagation. No production test accounts are created.
