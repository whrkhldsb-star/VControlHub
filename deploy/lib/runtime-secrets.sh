#!/usr/bin/env bash
# Generated secrets that installs from before they existed never received.
# install.sh creates them for new installs; deploy.sh calls this on every
# deploy so older ones catch up. Appends only — an existing value is never
# replaced, since the target gateways already hold it.

ensure_runtime_secrets() {
	local env_file="$1"
	[ -f "$env_file" ] || return 0
	# Without it, target direct connections ("目标直连") cannot be enabled.
	if ! grep -qE '^STORAGE_DIRECT_ACCESS_SECRET="?[^"[:space:]]' "$env_file"; then
		local secret
		secret="$(openssl rand -hex 24)"
		[ "${#secret}" -ge 32 ] || { echo "FAIL: could not generate STORAGE_DIRECT_ACCESS_SECRET" >&2; return 1; }
		printf 'STORAGE_DIRECT_ACCESS_SECRET="%s"\n' "$secret" >> "$env_file"
		echo "==> generated the missing STORAGE_DIRECT_ACCESS_SECRET in $env_file"
	fi
}
