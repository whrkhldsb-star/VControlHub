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
REPO_URL="${REPO_URL:-}"
SOURCE_DIR="${SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

log() { printf '\033[1;32m[%s]\033[0m %s\n' "$(date -Iseconds)" "$*"; }
warn() { printf '\033[1;33m[%s]\033[0m %s\n' "$(date -Iseconds)" "$*" >&2; }
fail() { printf '\033[1;31m[%s]\033[0m %s\n' "$(date -Iseconds)" "$*" >&2; exit 1; }
need_root() { [ "$(id -u)" -eq 0 ] || fail "Please run as root (or via sudo)."; }
have_cmd() { command -v "$1" >/dev/null 2>&1; }

shell_escape_sed_replacement() {
  printf '%s' "$1" | sed -e 's/[\&]/\\&/g'
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
    ""|*REPLACE_WITH*|*CHANGE_ME*|*CHANGE_THIS*|*your-domain.example*|*example.com*|*'***'*|*\*\*\**)
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
		log "  ○ Caddy: skipped (SKIP_CADDY=1)"
	elif have_cmd caddy; then
		log "  ✓ Caddy already installed: $(caddy version 2>/dev/null || echo 'present')"
	else
		log "  ✗ Caddy missing — installing"
		apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
		curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
		curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
		apt-get update
		apt-get install -y caddy
		log "  ✓ Caddy installed: $(caddy version 2>/dev/null || echo 'done')"
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
  # shellcheck disable=SC1090
  set -a; source "${ENV_FILE}"; set +a
  local required
  for required in DATABASE_URL AUTH_SESSION_SECRET ADMIN_INITIAL_PASSWORD; do
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
  local escaped
  escaped="$(shell_escape_sed_replacement "${secret}")"
  sed -i "s#^AUTH_SESSION_SECRET=.*#AUTH_SESSION_SECRET=${escaped}#" "${ENV_FILE}"
  AUTH_SESSION_SECRET="${secret}"
  log "Auto-generated AUTH_SESSION_SECRET"
  changed=1
 fi

 # ── ADMIN_INITIAL_PASSWORD ───────────────────────────────────────
 if is_placeholder_value "${ADMIN_INITIAL_PASSWORD:-}" || [ -z "${ADMIN_INITIAL_PASSWORD:-}" ]; then
  local admin_pw
  admin_pw="$(openssl rand -base64 24)"
  local escaped_pw
  escaped_pw="$(shell_escape_sed_replacement "${admin_pw}")"
  sed -i "s#^ADMIN_INITIAL_PASSWORD=.*#ADMIN_INITIAL_PASSWORD=${escaped_pw}#" "${ENV_FILE}"
  ADMIN_INITIAL_PASSWORD="${admin_pw}"
  warn "============================================================"
  warn "  Auto-generated ADMIN_INITIAL_PASSWORD (save this!):"
  warn "  ${admin_pw}"
  warn "============================================================"
  changed=1
 fi

 # ── NEXT_PUBLIC_APP_PUBLIC_LABEL ─────────────────────────────────
 if is_placeholder_value "${NEXT_PUBLIC_APP_PUBLIC_LABEL:-}" && [ -n "${DOMAIN:-}" ]; then
  local escaped
  escaped="$(shell_escape_sed_replacement "${DOMAIN}")"
  sed -i "s#^NEXT_PUBLIC_APP_PUBLIC_LABEL=.*#NEXT_PUBLIC_APP_PUBLIC_LABEL=${escaped}#" "${ENV_FILE}"
  log "Auto-set NEXT_PUBLIC_APP_PUBLIC_LABEL=${DOMAIN}"
  changed=1
 fi

 # ── SSH_WS_ALLOWED_ORIGINS ───────────────────────────────────────
 if is_placeholder_value "${SSH_WS_ALLOWED_ORIGINS:-}" && [ -n "${DOMAIN:-}" ]; then
  local origin="https://${DOMAIN}"
  local escaped
  escaped="$(shell_escape_sed_replacement "${origin}")"
  sed -i "s#^SSH_WS_ALLOWED_ORIGINS=.*#SSH_WS_ALLOWED_ORIGINS=${escaped}#" "${ENV_FILE}"
  log "Auto-set SSH_WS_ALLOWED_ORIGINS=${origin}"
  changed=1
 fi

 # ── AUTH_SESSION_COOKIE_NAME, ISSUER, AUDIENCE ───────────────────
 if is_placeholder_value "${AUTH_SESSION_COOKIE_NAME:-}" || [ -z "${AUTH_SESSION_COOKIE_NAME:-}" ]; then
  local cookie_name="${APP_SLUG}-session"
  local escaped
  escaped="$(shell_escape_sed_replacement "${cookie_name}")"
  sed -i "s#^AUTH_SESSION_COOKIE_NAME=.*#AUTH_SESSION_COOKIE_NAME=${escaped}#" "${ENV_FILE}"
  log "Auto-set AUTH_SESSION_COOKIE_NAME=${cookie_name}"
  changed=1
 fi

 if is_placeholder_value "${AUTH_SESSION_ISSUER:-}" || [ -z "${AUTH_SESSION_ISSUER:-}" ]; then
  local issuer="${APP_SLUG}"
  local escaped
  escaped="$(shell_escape_sed_replacement "${issuer}")"
  sed -i "s#^AUTH_SESSION_ISSUER=.*#AUTH_SESSION_ISSUER=${escaped}#" "${ENV_FILE}"
  log "Auto-set AUTH_SESSION_ISSUER=${issuer}"
  changed=1
 fi

 if is_placeholder_value "${AUTH_SESSION_AUDIENCE:-}" || [ -z "${AUTH_SESSION_AUDIENCE:-}" ]; then
  local audience="${APP_SLUG}-console"
  local escaped
  escaped="$(shell_escape_sed_replacement "${audience}")"
  sed -i "s#^AUTH_SESSION_AUDIENCE=.*#AUTH_SESSION_AUDIENCE=${escaped}#" "${ENV_FILE}"
  log "Auto-set AUTH_SESSION_AUDIENCE=${audience}"
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
	local pg_user_exists pg_db_exists
	pg_user_exists="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${PG_DB_USER}'" 2>/dev/null || true)"
	if [ "${pg_user_exists}" != "1" ]; then
		if [ -z "${PG_DB_PASSWORD}" ]; then
			PG_DB_PASSWORD="$(openssl rand -base64 24 | tr -d '\n')"
			warn "Generated random PostgreSQL password for ${PG_DB_USER}; saved to ${ENV_FILE}"
		fi
		log "Creating PostgreSQL user ${PG_DB_USER}"
		sudo -u postgres psql -c "CREATE USER ${PG_DB_USER} WITH ENCRYPTED PASSWORD '${PG_DB_PASSWORD}';" 2>/dev/null || warn "Failed to create PostgreSQL user (may already exist)"
	else
		# If user exists but we have a password, try to update it
		if [ -n "${PG_DB_PASSWORD}" ]; then
			sudo -u postgres psql -c "ALTER USER ${PG_DB_USER} WITH ENCRYPTED PASSWORD '${PG_DB_PASSWORD}';" 2>/dev/null || true
		fi
	fi

	pg_db_exists="$(sudo -u postgres psql -lqtAc "SELECT 1 FROM pg_database WHERE datname='${PG_DB_NAME}'" 2>/dev/null || true)"
	if [ "${pg_db_exists}" != "1" ]; then
		log "Creating PostgreSQL database ${PG_DB_NAME}"
		sudo -u postgres psql -c "CREATE DATABASE ${PG_DB_NAME} OWNER ${PG_DB_USER};" 2>/dev/null || warn "Failed to create PostgreSQL database (may already exist)"
	fi

	# Update DATABASE_URL in .env.local if it is still a placeholder
	local generated_url="postgresql://${PG_DB_USER}:${PG_DB_PASSWORD}@127.0.0.1:5432/${PG_DB_NAME}"
	local current_url
	current_url="$(grep '^DATABASE_URL=' "${ENV_FILE}" 2>/dev/null | head -1 | cut -d= -f2- || true)"
	if is_placeholder_value "${current_url}" || [ -z "${current_url}" ]; then
		log "Setting DATABASE_URL in ${ENV_FILE}"
		local escaped_url
		escaped_url="$(shell_escape_sed_replacement "${generated_url}")"
		sed -i "s#^DATABASE_URL=.*#DATABASE_URL=${escaped_url}#" "${ENV_FILE}"
	fi
}

build_app() {
  log "Installing dependencies and building application"
  cd "${APP_DIR}"
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
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
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
}

install_systemd() {
	log "Installing systemd units"
	local node_bin npm_bin npx_bin systemd_path
	node_bin="$(resolve_command node)"
	npm_bin="$(resolve_command npm)"
	npx_bin="$(resolve_command npx)"
	systemd_path="$(build_systemd_path "${node_bin}" "${npm_bin}" "${npx_bin}")"
	local svc
	for svc in next ssh-ws; do
		local src="${APP_DIR}/deploy/systemd/${APP_SLUG}-${svc}.service.example"
		if [ ! -f "${src}" ]; then
			src="${APP_DIR}/deploy/systemd/whrkhldsb-${svc}.service.example"
		fi
		[ -f "${src}" ] || fail "Systemd template not found: ${src}"
		local dst="${DESTDIR}/etc/systemd/system/${SERVICE_PREFIX}-${svc}.service"
		mkdir -p "$(dirname "${dst}")"
		# Remove immutable flag if present (from hardening or previous deployment)
		chattr -i "${dst}" 2>/dev/null || true
		sed \
			-e "s#{{SITE_NAME}}#${SITE_NAME}#g" \
			-e "s#{{APP_DIR}}#${APP_DIR}#g" \
			-e "s#{{ENV_FILE}}#${ENV_FILE}#g" \
			-e "s#{{SYSTEMD_PATH}}#${systemd_path}#g" \
			-e "s#{{NPM_BIN}}#${npm_bin}#g" \
			-e "s#{{NPX_BIN}}#${npx_bin}#g" \
			-e "s#{{APP_USER}}#${APP_USER}#g" \
			"${src}" > "${dst}"
		chmod 0644 "${dst}"
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
    -e "s#your-domain.example#${escaped_domain}#g" \
    -e "s#127.0.0.1:3000#${escaped_next}#g" \
    -e "s#127.0.0.1:3001#${escaped_ssh_ws}#g" \
	"${DESTDIR}/etc/caddy/Caddyfile"
	caddy validate --config "${DESTDIR}/etc/caddy/Caddyfile" --adapter caddyfile
  systemctl enable caddy
}

restart_services() {
  [ "${SKIP_RESTART}" = "1" ] && { warn "Skipping service restart"; return; }
  log "Restarting services"
  systemctl restart "${SERVICE_PREFIX}-next.service" "${SERVICE_PREFIX}-ssh-ws.service"
  [ "${SKIP_CADDY}" = "1" ] || systemctl reload caddy || systemctl restart caddy
  sleep 2
  systemctl --no-pager --lines=20 status "${SERVICE_PREFIX}-next.service" "${SERVICE_PREFIX}-ssh-ws.service" || true
  curl -fsS "http://${NEXT_HOST}:${NEXT_PORT}/login" >/dev/null || warn "Local login page did not return 2xx; check logs."
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
 restart_services
 log "Done. App directory: ${APP_DIR}"
}

main "$@"
