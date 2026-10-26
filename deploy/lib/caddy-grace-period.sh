# shellcheck shell=bash
# Caddy waits for open connections to finish before a reload (or stop)
# completes, and without grace_period it waits forever. A WebSocket whose
# browser stopped reading (a desktop stream with 4 MB unsent to Cloudflare)
# never finishes: `systemctl reload caddy` then hung until systemd gave up,
# and the deploy rolled back (2026-10-26). Bounded, Caddy closes what is left.
CADDY_GRACE_PERIOD="${CADDY_GRACE_PERIOD:-10s}"

caddyfile_has_grace_period() {
	grep -Eq '^[[:space:]]*grace_period[[:space:]]' "$1"
}

# Prints the Caddyfile with grace_period in its global options block,
# adding the block when the file has none (it must come first).
caddyfile_with_grace_period() {
	awk -v gp="$CADDY_GRACE_PERIOD" '
		!done && /^[[:space:]]*(#.*)?$/ { print; next }
		!done && /^[[:space:]]*\{[[:space:]]*$/ { print; print "\tgrace_period " gp; done = 1; next }
		!done { print "{"; print "\tgrace_period " gp; print "}"; print ""; done = 1 }
		{ print }
		END { if (!done) { print "{"; print "\tgrace_period " gp; print "}" } }
	' "$1"
}
