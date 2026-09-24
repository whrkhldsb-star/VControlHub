# Windows remote desktop gateway

Windows nodes use RDP, not SSH. The browser connects through the application's authenticated `/rdp` WebSocket endpoint. Windows credentials remain encrypted on the server. Text clipboard sync is enabled by default (`RDP_ENABLE_CLIPBOARD=false` to disable); drive sharing and printing stay disabled, and remote audio is opt-in via `RDP_AUDIO_ENABLED=true`.

## Gateway

Run a pinned guacd image on the application host. Never publish guacd on a public interface: it has no application authentication.

```sh
docker run -d --name vcontrolhub-guacd --restart unless-stopped \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --memory 512m --cpus 2 -p 127.0.0.1:4822:4822 \
  guacamole/guacd@sha256:8974eaa9ba32f713daf311e7cc8cd7e4cdfba1edea39eed75524e78ef4b08f4f
```

Enable `RDP_ENABLED=true` in both the application and SSH WebSocket service environments. Ensure the allowed WebSocket origins include the public application origin. Apply the Prisma migration with the normal deployment process before enabling Windows node creation.

Route `/rdp` to the existing WebSocket service (normally 127.0.0.1:3001), preserving cookies, Origin and the WebSocket upgrade. For Caddy, add alongside the existing `/ssh` rule:

```caddyfile
reverse_proxy /rdp 127.0.0.1:3001
```

Do not route `/rdp` directly to guacd. The application bridge verifies the authenticated session, node/team access and single-use ticket before opening a gateway connection.

## Session lifetime

guacd disconnects clients that stay silent for roughly 20 seconds, so keep-alive is handled at three layers:

- The browser forwards Guacamole `nop` instructions to guacd (the bridge never swallows them).
- The bridge itself sends `nop` to guacd every 5 seconds once the session is ready, so a background tab with throttled JavaScript timers cannot starve guacd.
- The bridge pings the browser every 5 seconds so an idle desktop never trips the browser-side receive timeout, and the browser reschedules its own keep-alive on that traffic.

Session lifetime is managed by the same runtime settings surface as the SSH timeouts (settings page → runtime):

- `runtime.rdpIdleTimeoutSec` (`RDP_IDLE_TIMEOUT_SEC`): close after this long without any browser traffic. `0` — the default — never idles a session out, matching the SSH idle default, because the transport itself already detects dead browsers.
- `runtime.rdpMaxSessionSec` (`RDP_MAX_SESSION_SEC`): absolute per-session cap, `0` = no cap. Set this if sessions must be re-authenticated periodically.
- Independent of both settings, a session with no browser traffic for 10 minutes is always treated as a dead transport (crashed browser on a half-open connection) and closed.

Clipboard sync is text-only (`text/plain`) in both directions; the bridge validates the clipboard stream instructions, bounds each blob, and caps a session at ~1.5 MB of clipboard traffic. File/drive transfer, printing and piping remain blocked.

Sessions also close when authorization is revoked. A slow browser pauses the guacd stream instead of being disconnected; the session is only dropped if the socket buffer exceeds 64 MB. After an unexpected drop of an established session, the browser retries with exponential backoff up to 8 times, and a failed first connection shows the error without retrying.

## Acceptance

- Check `docker inspect vcontrolhub-guacd` and verify only loopback port 4822 is published.
- Verify a real Windows login renders a desktop and accepts keyboard/mouse input through the public HTTPS application.
- With clipboard enabled (default), verify Ctrl+V delivers local text to the remote desktop and a remote copy reaches the local clipboard; verify oversized clipboard payloads are rejected and `file`/`pipe` instructions are still refused.
- Verify wrong credentials and untrusted certificates fail visibly; do not interpret TCP reachability as successful login.
- Prefer trusted RDP certificates; accepting a self-signed certificate is an explicit per-node choice.
- Verify cross-team access, ticket replay and foreign Origin requests are rejected.
- Verify Linux SSH continues working and Windows nodes never enter Linux onboarding.

RDP alone does not provide Windows CPU/memory monitoring or command execution. Those capabilities come from the Windows Agent channel instead — see [Windows Agent 设计](windows-agent.md).
