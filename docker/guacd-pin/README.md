# Exclusive-pin guacd image

Built locally (linux/arm64), immutable image ID:
`sha256:63a2346aa2a6928ebc9d135bad960548878ce274b346f0d50bb3e9d2ae886a05`

Tag: `vcontrolhub/guacd:1.6.0-exclusive-pin-v1`. This is a local image ID, NOT a registry manifest digest. No production cutover performed.

Build: `docker build -t vcontrolhub/guacd:1.6.0-exclusive-pin-v1 docker/guacd-pin`

Base guacd image is digest-pinned in Dockerfile. Genuine source downloaded from https://codeload.github.com/FreeRDP/FreeRDP/tar.gz/refs/tags/2.11.7 and checked against SHA256 `22dbeeaad065e93f152d70e04ec8eeab08aa32c406a96be64f252526623625a4`. Package repository dependencies are not snapshot-pinned; rebuilding is not promised to yield identical image IDs. Hardener source is copied from scripts/harden-freerdp-pin.py. Runtime ldd of libguac-client-rdp.so resolves all dependencies, including rebuilt FreeRDP/WinPR against original OpenSSL 1.1.

## Real TLS verification

`test_tls_integration.py` generates a local test certificate, negotiates X.224/TLS with actual guacd/FreeRDP, and measures post-TLS MCS connection data. Both test containers explicitly trust the certificate through SSL_CERT_FILE. No real user credentials are used. This proves native session certificate verification, not a complete desktop login.

Observed final passing matrix:
- Stock guacd + CA-trusted certificate + wrong pin + ignore=false: 427 post-TLS bytes (demonstrates upstream bypass).
- Hardened guacd + same certificate + correct pin: 427 bytes.
- Hardened guacd + same CA-trusted certificate + wrong pin: 0 bytes.
- Hardened guacd + wrong pin + ignore=true: 0 bytes.

Reproduce setup: run `python3 docker/guacd-pin/test_tls_integration.py --setup`; start stock/hardened test containers using host networking, bind guacd to 127.0.0.1, ports 4824/4823 respectively (`-b 127.0.0.1 -l 4824`, not `-p`), set `SSL_CERT_FILE=/test-ca.pem`, mount `/tmp/vch-pin-integration/cert.pem:/test-ca.pem:ro`. Then run test script. Server listens only on 127.0.0.1:3398. Test drains the guacd error/disconnect before each subsequent case to prevent automatic TLS reconnects from contaminating the next case.

Existing production container remained unchanged. Isolated hardened test container `vch-pin-hardened-test` remains available on 127.0.0.1:4823 for parent-agent authenticated testing, with a test CA mount; do not reuse that CA mount in production. Stock baseline test container is stopped after verification.

Scope: configured fingerprint is exclusive. Missing pins remain governed by native behavior and MUST be rejected by application policy. Application must validate strict single SHA256 syntax. Remote node authenticated desktop, known-host-specific behavior, and redirect/reconnect to changed certificate require further acceptance; cached certificate fast path is moved after exclusive pin verification in source, but not separately exercised here.
