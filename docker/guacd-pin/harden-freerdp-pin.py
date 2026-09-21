#!/usr/bin/env python3
"""Build-time hardening for FreeRDP 2.11.7, NOT a runtime/preflight pin.

Apply to libfreerdp/crypto/tls.c before building a dedicated guacd image.
Stock CertificateAcceptedFingerprints is an additional trust source: a mismatch
falls back to CA/known-hosts verification. This patch makes a configured pin
exclusive, including before the previously-accepted-certificate fast path.
Never deploy without full TLS integration tests against the rebuilt image.
"""
import argparse
from pathlib import Path

ORIGINAL = '''\t/* Check, if we already accepted this key. */
\tif (is_accepted(tls, pemCert, length))
\t{
\t\tverification_status = 1;
\t\tgoto end;
\t}

\tif (is_accepted_fingerprint(cert, tls->settings->CertificateAcceptedFingerprints))
\t{
\t\tverification_status = 1;
\t\tgoto end;
\t}'''

REPLACEMENT = '''\t/* VControlHub: configured fingerprints are exclusive, never additional trust.
\t * Evaluate on this session's TLS certificate before cached/CA/known-hosts
\t * acceptance. A mismatch MUST fail even if IgnoreCertificate is set. */
\tif (tls->settings->CertificateAcceptedFingerprints)
\t{
\t\tverification_status = -1;
\t\tif (is_accepted_fingerprint(cert, tls->settings->CertificateAcceptedFingerprints))
\t\t\tverification_status = 1;
\t\tgoto end;
\t}

\t/* Check, if we already accepted this key. */
\tif (is_accepted(tls, pemCert, length))
\t{
\t\tverification_status = 1;
\t\tgoto end;
\t}'''


def harden(source: str) -> str:
    if source.count(ORIGINAL) != 1:
        raise ValueError("Unsupported/already-patched FreeRDP TLS source; refusing to guess")
    return source.replace(ORIGINAL, REPLACEMENT, 1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tls_source", type=Path)
    args = parser.parse_args()
    result = harden(args.tls_source.read_text())
    args.tls_source.write_text(result)
    print("Patched TLS verification source. Not built, deployed, or integration-verified.")


if __name__ == "__main__":
    main()
