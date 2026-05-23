#!/usr/bin/env bash
# Portable one-command installer/deployer.
# Tested target: Debian/Ubuntu systemd host. Re-runnable and safe for upgrades.

set -euo pipefail

slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

APP_NAME="${APP_NAME:-whrkhldsb}"
APP_SLUG="${APP_SLUG:-$(slugify "${APP_NAME}")}"
[ -n "${APP_SLUG}" ] || APP_SLUG="whrkhldsb"
SITE_NAME="${SITE_NAME:-${APP_NAME}}"
SERVICE_PREFIX="${SERVICE_PREFIX:-${APP_SLUG}}"
APP_DIR="${APP_DIR:-/opt/${APP_SLUG}}"
APP_USER_EXPLICIT="${APP_USER+x}"
DESTDIR="${DESTDIR:-}"
APP_USER="${APP_USER:-${APP_SLUG}}"
if [ -z "${APP_USER_EXPLICIT}" ]; then
  case "${APP_DIR}" in
    /root|/root/*)
      # System users cannot traverse /root (0700 on most hosts). When deploying in
      # place under /root, default to root so systemd can chdir without weakening
      # /root permissions. Fresh portable installs still default to /opt/<slug>
      # with an isolated system user.
      APP_USER="root"
      ;;
  esac
fi
DOMAIN="${DOMAIN:-}"
NODE_VERSION_MAJOR="${NODE_VERSION_MAJOR:-22}"
NEXT_HOST="${NEXT_HOST:-127.0.0.1}"
NEXT_PORT="${NEXT_PORT:-3000}"
SSH_WS_HOST="${SSH_WS_HOST:-127.0.0.1}"
SSH_WS_PORT="${SSH_WS_PORT:-3001}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.local}"
ENV_TEMPLATE="${ENV_TEMPLATE:-${APP_DIR}/deploy/env.production.example}"
SKIP_PACKAGES="${SKIP_PACKAGES:-0}"
SKIP_CADDY="${SKIP_CADDY:-0}"
SKIP_DB_SETUP="${SKIP_DB_SETUP:-0}"
PG_AUTO_SETUP="${PG_AUTO_SETUP:-1}"
PG_DB_NAME="${PG_DB_NAME:-${APP_SLUG}}"
PG_DB_USER="${PG_DB_USER:-${APP_SLUG}}"
PG_DB_PASSWORD="${PG_DB_PASSWORD:-}"
SKIP_SEED="${SKIP_SEED:-0}"
SKIP_RESTART="${SKIP_RESTART:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
REPO_URL="${REPO_URL:-}"
SOURCE_DIR="${SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

log() { printf '\033[1;32m[%s]\033[0m %s\n' "$(date -Iseconds)" "$*"; }
warn() { printf '\033[1;33m[%s]\033[0m %s\n' "$(date -Iseconds)" "$*" >&2; }
fail() { printf '\033[1;31m[%s]\033[0m %s\n' "$(date -Iseconds)" "$*" >&2; exit 1; }
need_root() {
 local uid
 uid="$(id -u 2>/dev/null || printf '1')"
 [ "${uid}" = "0" ] || fail "Please run as root (or via sudo)."
}
have_cmd() { command -v "$1" >/dev/null 2>&1; }

shell_escape_sed_replacement() {
 # Escape &, \, /, #, and | for use in sed replacement strings.
 # Also escape newlines (rare in secrets but breaks sed if present).
 printf '%s' "$1" | sed -e 's/[&\/#|]/\\&/g'
}

sql_literal() {
  printf '%s' "$1" | sed "s/'/''/g"
}

urlencode() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

set_env_var() {
 local name="$1" value="${2:-}" escaped
 escaped="$(shell_escape_sed_replacement "${value}")"
 if grep -q "^${name}=" "${ENV_FILE}" 2>/dev/null; then
 sed -i "s|^${name}=.*|${name}=\"${escaped}\"|g" "${ENV_FILE}"
 else
 printf '%s="%s"\n' "${name}" "${value}" >> "${ENV_FILE}"
 fi
}

resolve_command() {
  local command_name="$1" resolved=""
  resolved="$(command -v "${command_name}" 2>/dev/null || true)"
  [ -n "${resolved}" ] || fail "Required command not found: ${command_name}"
  case "${resolved}" in
    /*) printf '%s\n' "${resolved}" ;;
    *) fail "Required command did not resolve to an absolute path: ${command_name}" ;;
  esac
}

resolve_node_tool() {
  local command_name="$1" resolved="" candidate=""

  resolved="$(resolve_command "${command_name}")"
  if [ "${APP_USER}" = "root" ]; then
    printf '%s\n' "${resolved}"
    return 0
  fi
  case "${resolved}" in
    /root/*)
      # The root user's Hermes/local Node shims live under /root, which non-root
      # service users cannot traverse and cause systemd status=203/EXEC failures.
      # In that case, fall back to a system-wide Node installation.
      ;;
    *)
      printf '%s\n' "${resolved}"
      return 0
      ;;
  esac

  for candidate in \
    "/usr/bin/${command_name}" \
    "/usr/local/bin/${command_name}" \
    "/bin/${command_name}" \
    "/opt/node/bin/${command_name}"; do
    if [ -x "${candidate}" ]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  fail "${command_name} resolved to ${resolved}, which is under /root and not executable by APP_USER=${APP_USER}. Install Node.js system-wide or set APP_USER=root for /root deployments."
}

build_systemd_path() {
  local node_path="$1" npm_path="$2" npx_path="$3"
  local path_value="" dir candidate
  for candidate in "${node_path}" "${npm_path}" "${npx_path}"; do
    dir="$(dirname "${candidate}")"
    case ":${path_value}:" in
      *":${dir}:"*) ;;
      *) path_value="${path_value:+${path_value}:}${dir}" ;;
    esac
  done
  for dir in /usr/local/sbin /usr/local/bin /usr/sbin /usr/bin /sbin /bin; do
    case ":${path_value}:" in
      *":${dir}:"*) ;;
      *) path_value="${path_value}:${dir}" ;;
    esac
  done
  printf '%s\n' "${path_value}"
}

is_placeholder_value() {
  local value="${1:-}"
  case "${value}" in
    ""|*REPLACE_WITH*|*CHANGE_ME*|*CHANGE_THIS*|*your-domain.example*|*example.com*|*\${encoded_pw}*|*\*\*\**)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

install_packages() {
	[ "${SKIP_PACKAGES}" = "1" ] && { warn "Skipping OS package installation"; return; }

	# ── Phase 1: Check what's already installed ──────────────────────
	local missing_pkgs=()
	local need_apt_update=0

	log "Checking system dependencies..."

	# Core tools that come from apt
	for pkg_cmd in "ca-certificates:ca-certificates" "curl:curl" "gnupg:gnupg" "git:git" "openssh-client:ssh" "sshpass:sshpass" "rsync:rsync" "build-essential:make"; do
		local cmd="${pkg_cmd%%:*}"
		local pkg="${pkg_cmd##*:}"
		if have_cmd "${cmd}"; then
			log "  ✓ ${cmd} already installed"
		else
			missing_pkgs+=("${pkg}")
			log "  ✗ ${cmd} missing — will install ${pkg}"
		fi
	done

	# Install missing apt packages in one batch
	if [ "${#missing_pkgs[@]}" -gt 0 ]; then
		log "Installing ${#missing_pkgs[@]} missing packages: ${missing_pkgs[*]}"
		apt-get update
		apt-get install -y "${missing_pkgs[@]}"
	else
		log "All core apt packages satisfied"
	fi

	# ── Phase 2: Node.js ─────────────────────────────────────────────
	local node_major=0
	if have_cmd node; then
		node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
	fi
	if [ "${node_major}" -ge "${NODE_VERSION_MAJOR}" ] 2>/dev/null; then
		log "  ✓ Node.js ${node_major} already installed (≥ ${NODE_VERSION_MAJOR})"
	else
		log "  ✗ Node.js missing or too old (found v${node_major}, need ≥ v${NODE_VERSION_MAJOR}) — installing"
		curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION_MAJOR}.x" | bash -
		apt-get install -y nodejs
		log "  ✓ Node.js $(node -v) installed"
	fi

	# ── Phase 3: Caddy ───────────────────────────────────────────────
	if [ "${SKIP_CADDY}" = "1" ]; then
		log " ○ Caddy: skipped (SKIP_CADDY=1)"
	elif have_cmd caddy; then
		log " ✓ Caddy already installed: $(caddy version 2>/dev/null || echo 'present')"
	else
		# Stop Apache/Nginx if they are occupying port 80/443 — Caddy needs them.
		if ss -tlnp 2>/dev/null | grep -q ':80\b'; then
			local port80_owner
			port80_owner="$(ss -tlnp 2>/dev/null | grep ':80\b' | head -1 | grep -oP 'users=\(\("\K[^"]+' || true)"
			if [ -n "${port80_owner}" ]; then
				log "Stopping ${port80_owner} on port 80 to make room for Caddy"
				systemctl stop "${port80_owner}" 2>/dev/null || true
				systemctl disable "${port80_owner}" 2>/dev/null || true
			fi
		fi
		log " ✗ Caddy missing — installing"
		apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
		curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
		curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
		apt-get update
		apt-get install -y caddy
		log " ✓ Caddy installed: $(caddy version 2>/dev/null || echo 'done')"
	fi

	# ── Phase 4: PostgreSQL ───────────────────────────────────────────
	if [ "${SKIP_DB_SETUP}" = "1" ]; then
		log "  ○ PostgreSQL: skipped (SKIP_DB_SETUP=1)"
	elif have_cmd psql; then
		local pg_ver
		pg_ver="$(psql --version 2>/dev/null | head -1 | grep -oP '\d+\.\d+' || echo 'present')"
		log "  ✓ PostgreSQL already installed: ${pg_ver}"
	else
		log "  ✗ PostgreSQL missing — installing"
		apt-get install -y postgresql postgresql-contrib
		log "  ✓ PostgreSQL installed: $(psql --version 2>/dev/null | head -1)"
	fi
}

prepare_app_user() {
  if ! id "${APP_USER}" >/dev/null 2>&1; then
    useradd --system --home "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
  fi
  mkdir -p "${APP_DIR}"
}

sync_source() {
  log "Syncing application to ${APP_DIR}"
  local source_real app_real
  source_real="$(cd "${SOURCE_DIR}" && pwd -P)"
  app_real="$(cd "${APP_DIR}" 2>/dev/null && pwd -P || true)"
  if [ -n "${app_real}" ] && [ "${source_real}" = "${app_real}" ]; then
    warn "SOURCE_DIR and APP_DIR are the same (${APP_DIR}); skipping source sync"
  elif [ -n "${REPO_URL}" ]; then
    if [ -d "${APP_DIR}/.git" ]; then
      git -C "${APP_DIR}" fetch --all --prune
      git -C "${APP_DIR}" pull --ff-only
    else
      rm -rf "${APP_DIR:?}"/*
      git clone "${REPO_URL}" "${APP_DIR}"
    fi
  else
 if have_cmd rsync; then
			rsync -a --delete \
--exclude .git --exclude node_modules --exclude .next --exclude backups --exclude storage --exclude tmp --exclude uploads --exclude downloads --exclude logs --exclude .env.local \
 "${SOURCE_DIR}/" "${APP_DIR}/"
    else
      warn "rsync not found; falling back to tar-based source sync"
      (cd "${SOURCE_DIR}" && tar \
        --exclude ./.git --exclude ./node_modules --exclude ./.next --exclude ./backups --exclude ./storage --exclude ./tmp --exclude ./uploads --exclude ./downloads --exclude ./logs --exclude ./.env.local \
        -cf - .) | (cd "${APP_DIR}" && tar -xf -)
    fi
  fi
  mkdir -p \
    "${APP_DIR}/storage" \
    "${APP_DIR}/tmp" \
    "${APP_DIR}/uploads" \
    "${APP_DIR}/downloads" \
    "${APP_DIR}/backups" \
    "${APP_DIR}/logs"
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
}

write_env_if_missing() {
 if [ ! -f "${ENV_FILE}" ]; then
 [ -f "${ENV_TEMPLATE}" ] || ENV_TEMPLATE="${APP_DIR}/.env.example"
 [ -f "${ENV_TEMPLATE}" ] || fail "No environment template found at ${ENV_TEMPLATE} or ${APP_DIR}/.env.example"
 log "Creating ${ENV_FILE} from ${ENV_TEMPLATE}"
 cp "${ENV_TEMPLATE}" "${ENV_FILE}"
 chmod 600 "${ENV_FILE}"
 warn "Created ${ENV_FILE} from template — placeholder secrets will be auto-generated next."
 fi
}

UNSAFE_PRODUCTION_FLAGS=(
  ENABLE_DEMO_FALLBACK
  AUTH_DEMO_FALLBACK
  SERVER_DEMO_FALLBACK
  STORAGE_DEMO_FALLBACK
  COMMAND_DEMO_FALLBACK
  SEED_DEMO_DATA
)

reject_unsafe_production_flags() {
  local flag
  for flag in "${UNSAFE_PRODUCTION_FLAGS[@]}"; do
    [ "${!flag:-false}" != "true" ] || fail "${flag}=true is not allowed for this production installer. Use an isolated local setup for demos."
  done
}

validate_env() {
 [ -f "${ENV_FILE}" ] || fail "Missing ${ENV_FILE}. Create it from deploy/env.production.example first."
 # Re-source .env.local to pick up any values written by auto_generate_env_secrets.
 # shellcheck disable=SC1090
 set -a; source "${ENV_FILE}"; set +a
 local required
 for required in DATABASE_URL AUTH_SESSION_SECRET ADMIN_INITIAL_PASSWORD SSH_WS_SECRET ENCRYPTION_KEY; do
 [ -n "${!required:-}" ] || fail "${required} is required in ${ENV_FILE}."
 if is_placeholder_value "${!required:-}"; then
 fail "${required} still contains a placeholder in ${ENV_FILE}."
 fi
 done
 if [ "${#AUTH_SESSION_SECRET}" -lt 32 ]; then
 fail "AUTH_SESSION_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 48"
 fi
 if [ -n "${SSH_WS_ALLOWED_ORIGINS:-}" ] && is_placeholder_value "${SSH_WS_ALLOWED_ORIGINS}"; then
 fail "SSH_WS_ALLOWED_ORIGINS still contains a placeholder in ${ENV_FILE}."
 fi
 if [ -n "${NEXT_PUBLIC_APP_PUBLIC_LABEL:-}" ] && is_placeholder_value "${NEXT_PUBLIC_APP_PUBLIC_LABEL}"; then
 fail "NEXT_PUBLIC_APP_PUBLIC_LABEL still contains a placeholder in ${ENV_FILE}."
 fi
  reject_unsafe_production_flags
}

auto_generate_env_secrets() {
 [ -f "${ENV_FILE}" ] || return 0
 # shellcheck disable=SC1090
 set -a; source "${ENV_FILE}"; set +a

 local changed=0

 # ── AUTH_SESSION_SECRET ──────────────────────────────────────────
 if is_placeholder_value "${AUTH_SESSION_SECRET:-}" || [ -z "${AUTH_SESSION_SECRET:-}" ]; then
 local secret
 secret="$(openssl rand -base64 48)"
 set_env_var AUTH_SESSION_SECRET "${secret}"
 AUTH_SESSION_SECRET="${secret}"
 log "Auto-generated AUTH_SESSION_SECRET"
 changed=1
 fi

 # ── ADMIN_INITIAL_PASSWORD ───────────────────────────────────────
 if is_placeholder_value "${ADMIN_INITIAL_PASSWORD:-}" || [ -z "${ADMIN_INITIAL_PASSWORD:-}" ]; then
 local admin_pw
 admin_pw="$(openssl rand -base64 24)"
 set_env_var ADMIN_INITIAL_PASSWORD "${admin_pw}"
 ADMIN_INITIAL_PASSWORD="${admin_pw}"
 warn "============================================================"
 warn " Auto-generated ADMIN_INITIAL_PASSWORD (save this!):"
 warn " ${admin_pw}"
 warn "============================================================"
 changed=1
 fi

 # ── NEXT_PUBLIC_APP_PUBLIC_LABEL ─────────────────────────────────
 if is_placeholder_value "${NEXT_PUBLIC_APP_PUBLIC_LABEL:-}"; then
 if [ -n "${DOMAIN:-}" ]; then
 set_env_var NEXT_PUBLIC_APP_PUBLIC_LABEL "${DOMAIN}"
 log "Auto-set NEXT_PUBLIC_APP_PUBLIC_LABEL=${DOMAIN}"
 changed=1
 else
 # DOMAIN not set — clear the placeholder so validate_env won't reject it
 set_env_var NEXT_PUBLIC_APP_PUBLIC_LABEL ""
 NEXT_PUBLIC_APP_PUBLIC_LABEL=""
 warn "DOMAIN not set; cleared NEXT_PUBLIC_APP_PUBLIC_LABEL placeholder"
 fi
 fi

	# The SSH_WS_ALLOWED_ORIGINS auto-set logic lives in generate_or_validate_env()
# (lines 419-444) — it covers both domain and IP-only modes with localhost fallbacks.
# This block below is removed to avoid double-execution with wrong :NEXT_PORT suffix.
#
# ── SSH_WS_ALLOWED_ORIGINS ───────────────────────────────────────
# (consolidated into generate_or_validate_env below)

 # ── AUTH_SESSION_COOKIE_NAME, ISSUER, AUDIENCE ───────────────────
 if is_placeholder_value "${AUTH_SESSION_COOKIE_NAME:-}" || [ -z "${AUTH_SESSION_COOKIE_NAME:-}" ]; then
 local cookie_name="${APP_SLUG}-session"
 set_env_var AUTH_SESSION_COOKIE_NAME "${cookie_name}"
 log "Auto-set AUTH_SESSION_COOKIE_NAME=${cookie_name}"
 changed=1
 fi

 if is_placeholder_value "${AUTH_SESSION_ISSUER:-}" || [ -z "${AUTH_SESSION_ISSUER:-}" ]; then
 local issuer="${APP_SLUG}"
 set_env_var AUTH_SESSION_ISSUER "${issuer}"
 log "Auto-set AUTH_SESSION_ISSUER=${issuer}"
 changed=1
 fi

 if is_placeholder_value "${AUTH_SESSION_AUDIENCE:-}" || [ -z "${AUTH_SESSION_AUDIENCE:-}" ]; then
 local audience="${APP_SLUG}-console"
 set_env_var AUTH_SESSION_AUDIENCE "${audience}"
 log "Auto-set AUTH_SESSION_AUDIENCE=${audience}"
 changed=1
 fi

 # ── SSH_WS_SECRET ────────────────────────────────────────────────
 if is_placeholder_value "${SSH_WS_SECRET:-}" || [ -z "${SSH_WS_SECRET:-}" ]; then
 local ws_secret
 ws_secret="$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 48)"
 set_env_var SSH_WS_SECRET "${ws_secret}"
 SSH_WS_SECRET="${ws_secret}"
 log "Auto-generated SSH_WS_SECRET"
 changed=1
 fi

 # ── NEXT_PUBLIC_SSH_WS_SECRET ────────────────────────────────────
 # Older builds read this value on the browser side; keep it in sync when present.
 if is_placeholder_value "${NEXT_PUBLIC_SSH_WS_SECRET:-}" || [ -z "${NEXT_PUBLIC_SSH_WS_SECRET:-}" ] || [ "${NEXT_PUBLIC_SSH_WS_SECRET:-}" != "${SSH_WS_SECRET:-}" ]; then
 set_env_var NEXT_PUBLIC_SSH_WS_SECRET "${SSH_WS_SECRET:-}"
 NEXT_PUBLIC_SSH_WS_SECRET="${SSH_WS_SECRET:-}"
 log "Synced NEXT_PUBLIC_SSH_WS_SECRET with SSH_WS_SECRET"
 changed=1
 fi

 # ── ENCRYPTION_KEY (for SSH private key encryption at rest) ──────
 if is_placeholder_value "${ENCRYPTION_KEY:-}" || [ -z "${ENCRYPTION_KEY:-}" ]; then
 local enc_key
 enc_key="$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 48)"
 set_env_var ENCRYPTION_KEY "${enc_key}"
 ENCRYPTION_KEY="${enc_key}"
 log "Auto-generated ENCRYPTION_KEY"
 changed=1
 fi

 # ── SSH_WS_ALLOWED_ORIGINS ────────────────────────────────────────
 # Must include the origin(s) that the browser uses to access the site.
 # When using Apache/Caddy reverse proxy, the browser origin is the
 # external URL (http://IP or https://domain), NOT localhost:3000.
 if is_placeholder_value "${SSH_WS_ALLOWED_ORIGINS:-}" || [ -z "${SSH_WS_ALLOWED_ORIGINS:-}" ]; then
 local ws_origins=""
 if [ -n "${DOMAIN:-}" ]; then
 ws_origins="https://${DOMAIN},http://${DOMAIN}"
 else
 # IP-only deployment — auto-detect external IP
 local ext_ip=""
 ext_ip="$(ip -4 addr show scope global 2>/dev/null | grep -oP 'inet \K[0-9.]+' | head -1)" || true
 [ -z "${ext_ip}" ] && ext_ip="$(curl -fsS --max-time 3 ifconfig.me 2>/dev/null)" || true
 if [ -n "${ext_ip}" ]; then
 ws_origins="http://${ext_ip}"
 fi
 fi
 # Always allow localhost for development / internal health checks
 ws_origins="http://localhost:3000,http://127.0.0.1:3000${ws_origins:+,}${ws_origins}"
 set_env_var SSH_WS_ALLOWED_ORIGINS "${ws_origins}"
 SSH_WS_ALLOWED_ORIGINS="${ws_origins}"
 log "Auto-set SSH_WS_ALLOWED_ORIGINS=${ws_origins}"
 changed=1
 fi

 if [ "${changed}" -eq 1 ]; then
 chmod 600 "${ENV_FILE}"
 fi
}

create_runtime_dirs() {
  log "Creating runtime directories"
  mkdir -p \
    "${APP_DIR}/storage" \
    "${APP_DIR}/tmp" \
    "${APP_DIR}/uploads" \
    "${APP_DIR}/downloads" \
    "${APP_DIR}/backups" \
    "${APP_DIR}/logs" \
    "${STORAGE_ROOT:-/var/lib/${APP_SLUG}/storage}" \
    "${DOWNLOAD_ROOT:-/var/lib/${APP_SLUG}/downloads}" \
    "${BACKUP_DIR:-/var/backups/${APP_SLUG}}"
  chown -R "${APP_USER}:${APP_USER}" \
    "${APP_DIR}/storage" \
    "${APP_DIR}/tmp" \
    "${APP_DIR}/uploads" \
    "${APP_DIR}/downloads" \
    "${APP_DIR}/backups" \
    "${APP_DIR}/logs" \
    "${STORAGE_ROOT:-/var/lib/${APP_SLUG}/storage}" \
    "${DOWNLOAD_ROOT:-/var/lib/${APP_SLUG}/downloads}" \
    "${BACKUP_DIR:-/var/backups/${APP_SLUG}}"
}

setup_postgres() {
	[ "${PG_AUTO_SETUP}" = "1" ] || { warn "Skipping PostgreSQL auto-setup"; return; }
	[ "${SKIP_DB_SETUP}" = "1" ] && { warn "Skipping PostgreSQL setup (SKIP_DB_SETUP=1)"; return; }
	have_cmd psql || { warn "psql not found; skipping PostgreSQL auto-setup"; return; }

	# Ensure PostgreSQL is running
	if ! systemctl is-active --quiet postgresql 2>/dev/null; then
		log "Starting PostgreSQL service"
		systemctl start postgresql
		systemctl enable postgresql
	fi

	# Create database and user if they do not exist
	local pg_user_exists pg_db_exists pg_password_sql
	pg_password_sql="$(sql_literal "${PG_DB_PASSWORD}")"
	pg_user_exists="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${PG_DB_USER}'" 2>/dev/null || true)"
	if [ "${pg_user_exists}" != "1" ]; then
		if [ -z "${PG_DB_PASSWORD}" ]; then
			PG_DB_PASSWORD="$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)"
			pg_password_sql="$(sql_literal "${PG_DB_PASSWORD}")"
			set_env_var PG_DB_PASSWORD "${PG_DB_PASSWORD}"
			warn "Generated random PostgreSQL password for ${PG_DB_USER}; saved to ${ENV_FILE}"
		fi
		log "Creating PostgreSQL user ${PG_DB_USER}"
		sudo -u postgres psql -c "CREATE USER ${PG_DB_USER} WITH ENCRYPTED PASSWORD '${pg_password_sql}';" 2>/dev/null || warn "Failed to create PostgreSQL user (may already exist)"
	else
		if [ -z "${PG_DB_PASSWORD}" ]; then
			PG_DB_PASSWORD="$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)"
			pg_password_sql="$(sql_literal "${PG_DB_PASSWORD}")"
			set_env_var PG_DB_PASSWORD "${PG_DB_PASSWORD}"
			warn "Generated random PostgreSQL password for existing user ${PG_DB_USER}; saved to ${ENV_FILE}"
		fi
		sudo -u postgres psql -c "ALTER USER ${PG_DB_USER} WITH ENCRYPTED PASSWORD '${pg_password_sql}';" 2>/dev/null || true
	fi

	pg_db_exists="$(sudo -u postgres psql -lqtAc "SELECT 1 FROM pg_database WHERE datname='${PG_DB_NAME}'" 2>/dev/null || true)"
	if [ "${pg_db_exists}" != "1" ]; then
		log "Creating PostgreSQL database ${PG_DB_NAME}"
		sudo -u postgres psql -c "CREATE DATABASE ${PG_DB_NAME} OWNER ${PG_DB_USER};" 2>/dev/null || warn "Failed to create PostgreSQL database (may already exist)"
	fi

	# Always sync DATABASE_URL with PG_DB_PASSWORD to prevent mismatch
	local generated_url current_url current_pw need_url_update encoded_pw
	encoded_pw="$(urlencode "${PG_DB_PASSWORD}")"
	if [ -n "${PG_DB_PASSWORD}" ]; then
		generated_url="postgresql://${PG_DB_USER}:${encoded_pw}@127.0.0.1:5432/${PG_DB_NAME}"
	else
		generated_url="postgresql://${PG_DB_USER}@127.0.0.1:5432/${PG_DB_NAME}"
	fi
	current_url="${DATABASE_URL:-}"
	need_url_update=0
	if is_placeholder_value "${current_url}" || [ -z "${current_url}" ]; then
		need_url_update=1
	elif [ -n "${PG_DB_PASSWORD}" ]; then
		current_pw="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(urllib.parse.urlparse(sys.argv[1]).password or ""))' "${current_url}" 2>/dev/null || true)"
		if [ "${current_pw}" != "${PG_DB_PASSWORD}" ]; then
			need_url_update=1
		fi
	fi
	if [ "${need_url_update}" -eq 1 ]; then
		log "Updating DATABASE_URL in ${ENV_FILE} (syncing with PG_DB_PASSWORD)"
		set_env_var DATABASE_URL "${generated_url}"
		DATABASE_URL="${generated_url}"
	fi
}

build_app() {
 log "Installing dependencies and building application"
 cd "${APP_DIR}"
 # Ensure native build tools are available (needed by npm ci / node-gyp)
 if ! have_cmd make || ! have_cmd gcc; then
 log "Installing build-essential (make, gcc, etc.) for native modules"
 apt-get install -y build-essential python3
 fi
 set -a
 # shellcheck disable=SC1090
 source "${ENV_FILE}"
	set +a
	export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}"
	export NEXT_TELEMETRY_DISABLED="${NEXT_TELEMETRY_DISABLED:-1}"
	if [ "${SKIP_BUILD}" = "1" ]; then
		log "Skipping npm install and build (SKIP_BUILD=1)"
		return
	fi
	npm ci
	npm run prisma:generate
	if [ "${SKIP_DB_SETUP}" != "1" ]; then
	npm run prisma:deploy
	fi
	if [ "${SKIP_DB_SETUP}" != "1" ] && [ "${SKIP_SEED}" != "1" ]; then
	log "Seeding database (admin user, roles, permissions)"
	npm run db:seed
	fi
	npm run build
	npm run build:runtime
	# The build cache is useful only between builds. Removing it after a successful
	# production deploy keeps small VPS disks from filling up while preserving all
	# runtime files (.next/server, .next/static, dist, node_modules).
	rm -rf .next/cache
	# Runtime does not need TypeScript, test libraries, ESLint, or the Prisma CLI.
	# Prune them after migrations/builds to reduce production disk usage and module
	# scan overhead. Future upgrades still run npm ci first, so build tools return
	# before the next deploy.
	npm prune --omit=dev
 # Verify compiled runtime entrypoints are available before systemd restart.
 if [ ! -f dist/server.js ] || [ ! -f dist/ssh-ws-proxy.js ]; then
   fail "Runtime bundle missing after build. Expected dist/server.js and dist/ssh-ws-proxy.js."
 fi
 chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
}

install_systemd() {
	log "Installing systemd units"
	if [ -n "${DESTDIR}" ]; then
		case "${DESTDIR}" in
			/tmp/*|/var/tmp/*) ;;
			*) fail "Refusing to install systemd units with DESTDIR=${DESTDIR}. DESTDIR is only for isolated installer tests under /tmp or /var/tmp." ;;
		esac
	fi
	local node_bin npm_bin npx_bin systemd_path
	node_bin="$(resolve_node_tool node)"
	npm_bin="$(resolve_node_tool npm)"
	npx_bin="$(resolve_node_tool npx)"
	systemd_path="$(build_systemd_path "${node_bin}" "${npm_bin}" "${npx_bin}")"
	local svc
	for svc in next ssh-ws; do
		local src="${APP_DIR}/deploy/systemd/${APP_SLUG}-${svc}.service.example"
		if [ ! -f "${src}" ]; then
			src="${APP_DIR}/deploy/systemd/whrkhldsb-${svc}.service.example"
		fi
		[ -f "${src}" ] || fail "Systemd template not found: ${src}"
		if [ -n "${DESTDIR}" ]; then
			case "${src}" in
				/tmp/*|/var/tmp/*) ;;
				*) fail "Refusing to use production systemd template source ${src} while DESTDIR=${DESTDIR}. Test templates must live inside the isolated temp app dir." ;;
			esac
		fi
		if awk '
			/^\[/ { section=$0 }
			section == "[Unit]" && /^[[:space:]]*(WorkingDirectory|EnvironmentFile|User|Group)=/ { bad=1 }
			END { exit bad ? 0 : 1 }
		' "${src}"; then
			fail "Invalid systemd template ${src}: service-only keys must be under [Service], not [Unit]. Refusing to install a broken unit."
		fi
		if ! grep -Eq '^\[Service\]' "${src}" || ! grep -Eq '^ExecStart=' "${src}"; then
			fail "Invalid systemd template ${src}: missing [Service] or ExecStart."
		fi
		local dst="${DESTDIR}/etc/systemd/system/${SERVICE_PREFIX}-${svc}.service"
		if [ -n "${DESTDIR}" ] && [ "${SKIP_RESTART}" != "1" ]; then
			fail "Refusing to write systemd units under DESTDIR=${DESTDIR} unless SKIP_RESTART=1. DESTDIR is for isolated installer tests only."
		fi
		mkdir -p "$(dirname "${dst}")"
		# Remove immutable flag if present (from hardening or previous deployment)
		chattr -i "${dst}" 2>/dev/null || true
sed \
			-e "s|{{SITE_NAME}}|${SITE_NAME}|g" \
			-e "s|{{APP_DIR}}|${APP_DIR}|g" \
			-e "s|{{ENV_FILE}}|${ENV_FILE}|g" \
			-e "s|{{SYSTEMD_PATH}}|${systemd_path}|g" \
			-e "s|{{NPM_BIN}}|${npm_bin}|g" \
			-e "s|{{NPX_BIN}}|${npx_bin}|g" \
			-e "s|{{APP_USER}}|${APP_USER}|g" \
			-e "s|{{APP_SLUG}}|${APP_SLUG}|g" \
			-e "s|{{SERVICE_PREFIX}}|${SERVICE_PREFIX}|g" \
			"${src}" > "${dst}"
		chmod 0644 "${dst}"
		systemd-analyze verify "${dst}" >/dev/null 2>&1 || warn "systemd-analyze verify reported warnings for ${dst}"
	done
	systemctl daemon-reload
	systemctl enable "${SERVICE_PREFIX}-next.service" "${SERVICE_PREFIX}-ssh-ws.service"
}
install_caddy() {
 [ "${SKIP_CADDY}" = "1" ] && { warn "Skipping Caddy setup"; return; }
 [ -n "${DOMAIN}" ] || { warn "DOMAIN is empty; skipping Caddy config"; return; }
 log "Installing Caddy reverse proxy for ${DOMAIN}"
 install -m 0644 "${APP_DIR}/deploy/Caddyfile.example" "${DESTDIR}/etc/caddy/Caddyfile"
 local escaped_domain escaped_next escaped_ssh_ws
 escaped_domain="$(shell_escape_sed_replacement "${DOMAIN}")"
 escaped_next="$(shell_escape_sed_replacement "${NEXT_HOST}:${NEXT_PORT}")"
 escaped_ssh_ws="$(shell_escape_sed_replacement "${SSH_WS_HOST}:${SSH_WS_PORT}")"
sed -i \
  -e "s|your-domain.example|${escaped_domain}|g" \
  -e "s|127.0.0.1:3000|${escaped_next}|g" \
  -e "s|127.0.0.1:3001|${escaped_ssh_ws}|g" \
  "${DESTDIR}/etc/caddy/Caddyfile"
 caddy validate --config "${DESTDIR}/etc/caddy/Caddyfile" --adapter caddyfile
 systemctl enable caddy
 # Ensure Apache/Nginx is not stealing port 80/443 from Caddy.
 if systemctl is-active --quiet apache2 2>/dev/null; then
 log "Stopping Apache2 (Caddy will handle ports 80/443)"
 systemctl stop apache2
 systemctl disable apache2
 fi
 if systemctl is-active --quiet nginx 2>/dev/null; then
 log "Stopping Nginx (Caddy will handle ports 80/443)"
 systemctl stop nginx
 systemctl disable nginx
 fi
}

install_apache() {
 # When SKIP_CADDY=1, set up Apache as the reverse proxy instead.
 # This covers IP-only deployments where no domain/TLS is needed.
 [ "${SKIP_CADDY}" = "1" ] || { return; }
 if ! have_cmd apache2 && ! have_cmd apachectl; then
  log "Apache not found — installing"
  apt-get install -y apache2
 fi
 log "Installing Apache reverse proxy config"
 a2enmod proxy proxy_http proxy_wstunnel rewrite headers 2>/dev/null || true

 # Determine ServerName: use DOMAIN if set, otherwise auto-detect external IP
 local server_name="${DOMAIN:-}"
 if [ -z "${server_name}" ]; then
  server_name="$(ip -4 addr show scope global 2>/dev/null | grep -oP 'inet \K[0-9.]+' | head -1)" || true
  if [ -z "${server_name}" ]; then
   server_name="$(curl -fsS --max-time 3 ifconfig.me 2>/dev/null)" || true
  fi
  [ -n "${server_name}" ] || fail "Cannot determine server IP for Apache ServerName. Set DOMAIN= or SKIP_CADDY=0."
 fi

 local apache_src="${APP_DIR}/deploy/apache-next-proxy.example.conf"
 [ -f "${apache_src}" ] || fail "Apache template not found: ${apache_src}"
 local apache_dst="${DESTDIR}/etc/apache2/sites-available/next-proxy.conf"
 mkdir -p "$(dirname "${apache_dst}")"

 local escaped_server_name escaped_next_host_port escaped_ssh_ws_host_port
 escaped_server_name="$(shell_escape_sed_replacement "${server_name}")"
 escaped_next_host_port="$(shell_escape_sed_replacement "${NEXT_HOST}:${NEXT_PORT}")"
 escaped_ssh_ws_host_port="$(shell_escape_sed_replacement "${SSH_WS_HOST}:${SSH_WS_PORT}")"

sed \
  -e "s|{{SERVER_NAME}}|${escaped_server_name}|g" \
  -e "s|{{NEXT_HOST}}:{{NEXT_PORT}}|${escaped_next_host_port}|g" \
  -e "s|{{SSH_WS_HOST}}:{{SSH_WS_PORT}}|${escaped_ssh_ws_host_port}|g" \
  "${apache_src}" > "${apache_dst}"
 chmod 0644 "${apache_dst}"

 # Disable default site, enable our proxy site
 a2dissite 000-default 2>/dev/null || true
 a2ensite next-proxy 2>/dev/null || true
 apache2ctl configtest 2>/dev/null || warn "Apache config test had warnings"
 systemctl enable apache2
 log "Apache reverse proxy configured for ${server_name} → ${NEXT_HOST}:${NEXT_PORT} + SSH-WS ${SSH_WS_HOST}:${SSH_WS_PORT}"
}

restart_services() {
 [ "${SKIP_RESTART}" = "1" ] && { warn "Skipping service restart"; return; }
 log "Restarting services"
 systemctl restart "${SERVICE_PREFIX}-next.service" "${SERVICE_PREFIX}-ssh-ws.service"
 [ "${SKIP_CADDY}" = "1" ] || systemctl reload caddy || systemctl restart caddy
 # Wait for Next.js to be ready (standalone server can take a few seconds)
 local retries=15
 while [ "${retries}" -gt 0 ]; do
 if curl -fsS "http://${NEXT_HOST}:${NEXT_PORT}/login" >/dev/null 2>&1; then
 log " ✓ Next.js is responding on port ${NEXT_PORT}"
 break
 fi
 retries=$((retries - 1))
 sleep 2
 done
 if [ "${retries}" -eq 0 ]; then
 warn "Next.js did not respond on port ${NEXT_PORT} within 30s; check logs:"
 journalctl --no-pager --lines=30 -u "${SERVICE_PREFIX}-next.service" || true
 fi
 systemctl --no-pager --lines=20 status "${SERVICE_PREFIX}-next.service" "${SERVICE_PREFIX}-ssh-ws.service" || true
}

main() {
 need_root
 install_packages
 prepare_app_user
 sync_source
 write_env_if_missing
 auto_generate_env_secrets
 setup_postgres
 validate_env
 if [ -x "${APP_DIR}/deploy/preflight.sh" ]; then
 APP_DIR="${APP_DIR}" ENV_FILE="${ENV_FILE}" NEXT_HOST="${NEXT_HOST}" NEXT_PORT="${NEXT_PORT}" SSH_WS_PORT="${SSH_WS_PORT}" "${APP_DIR}/deploy/preflight.sh"
 fi
 create_runtime_dirs
 build_app
 install_systemd
 install_caddy
 install_apache
 restart_services
 log "Done. App directory: ${APP_DIR}"
}

main "$@"
