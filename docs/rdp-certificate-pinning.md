# RDP exclusive certificate pinning: verified blocker and build-time patch

## Status — NOT deployed, NOT completed

The current gateway is guacd **1.6.0**, linked to **FreeRDP 2.11.7** (observed container libraries). Its live Guacamole `args` handshake advertises `cert-fingerprints` and `cert-tofu`. However **native `cert-fingerprints` alone is NOT exclusive pinning**.

In FreeRDP 2.11.7 `libfreerdp/crypto/tls.c`, `tls_verify_certificate()` accepts a matching fingerprint early, but a mismatching fingerprint falls through to other trust sources: `IgnoreCertificate`, CA validation, and known-hosts. A wrong pin can therefore still connect to an otherwise-trusted certificate. FreeRDP 3.15.0 has the same early-accept/fallthrough shape. Simply sending `ignore-cert=false` plus `cert-fingerprints` must not be presented as fail-closed pinning.

Sources:
- https://github.com/apache/guacamole-server/blob/1.6.0/src/protocols/rdp/settings.c
- https://github.com/FreeRDP/FreeRDP/blob/2.11.7/libfreerdp/crypto/tls.c
- https://github.com/FreeRDP/FreeRDP/blob/3.15.0/libfreerdp/crypto/tls.c

## Observed TOFU baseline

A credential-free X.224 negotiation followed by TLS 1.3 to `2.26.201.79:3389` returned this **whole-certificate DER SHA-256** (NOT SPKI/public-key hash):

```
72f2c7dd3716fb4aee2c1418706200562bd78c553d565f48f5591b87af88d480
```

This is only an observed TOFU baseline, not independent proof of identity. No password was used or changed. The application/server record and running gateway configuration were not changed. The parent's transparent relay independently observed the same certificate; that does not turn TOFU into independently verified trust.

## Smallest secure route

Build a dedicated guacd image with the supplied build-time FreeRDP hardener:

```
python3 scripts/harden-freerdp-pin.py /build/FreeRDP/libfreerdp/crypto/tls.c
```

It requires the exact expected 2.11.7 verification block and fails on unknown, duplicate, or already-patched source. A configured fingerprint is evaluated against the **actual RDP session's TLS certificate**, before cached-certificate acceptance, and mismatch goes directly to failure. This avoids a separate probe/TOCTOU gap and avoids implementing an NLA/CredSSP-breaking TLS-terminating proxy. CredSSP channel binding remains end-to-end in FreeRDP.

The script is preparation only: **the patched native library has not been compiled or integration-tested**. No new image was deployed. Existing runtime code remains unchanged and still supports unsafe ignore mode; this work does not claim otherwise.

After building and validating that image, application integration must:

1. Store one strict SHA-256 whole-certificate fingerprint per node, with endpoint/pin changes invalidating outstanding tickets and active sessions.
2. Send `ignore-cert=false`, `cert-tofu=false`, and `cert-fingerprints=sha256:<colon-separated hexadecimal digest>`; reject malformed fingerprints rather than forwarding arbitrary FreeRDP syntax.
3. Refuse a pinned session before sending credentials if the gateway lacks `cert-fingerprints`. Advertising the parameter alone does NOT prove exclusive semantics: pin the audited custom image digest in deployment and attest/check that build operationally.
4. Never silently fall back to the stock image, CA trust, known-hosts, ignore mode, or a fresh TOFU pin after mismatch.
5. Confirm the administrator's TOFU enrollment explicitly and maintain an audited, deliberate rotation workflow. Certificate renewal changes a whole-cert pin even with the same key.

## Verification and remaining acceptance

Executed: 3 Python unit tests pass; patch applies exactly once to fetched upstream FreeRDP 2.11.7 source. Those tests verify source transformation/refusal semantics, not native TLS behavior.

Required before calling this complete:
- Build patched FreeRDP/guacd reproducibly, record immutable image digest.
- Real TLS integration: correct pin succeeds; wrong pin fails **even when the presented cert is CA-trusted or in known_hosts**; missing/malformed pin rejected by application.
- Redirect/reconnect must also reject a changed certificate; no cached acceptance bypass.
- Complete application/schema/UI/ticket integration and full typecheck/regression gates.
- Authorized desktop-render/input acceptance through the application with ignore mode off.

A transparent TCP relay preserves the server certificate and works with session-level FreeRDP verification. A TLS-terminating proxy would additionally need to handle CredSSP public-key binding correctly; a preflight socket check followed by `ignore-cert=true` is explicitly NOT acceptable.
