APP_DIR ?= $(CURDIR)
DOMAIN ?=
SERVICE_PREFIX ?= $(notdir $(APP_DIR))
SMOKE_PUBLIC_URL ?=

.PHONY: help verify ci-local ci-local-full build runtime deploy-check drift-check smoke smoke-systemd smoke-http installer-fakeroot restart status logs package

help:
	@printf 'VControlHub maintenance targets:\n'
	@printf '  make verify        Run prisma generate, typecheck, lint, tests, Next build and runtime bundle\n'
	@printf '  make ci-local      Fast CI parity: prisma generate + typecheck + lint + unit tests\n'
	@printf '  make ci-local-full Full CI parity: + coverage + next build + runtime bundle\n'
	@printf '  make build         Run Next.js production build\n'
	@printf '  make runtime       Build dist/server.js and dist/ssh-ws-proxy.js\n'
	@printf '  make restart       Restart SERVICE_PREFIX=$(SERVICE_PREFIX)-next/-ssh-ws when available\n'
	@printf '  make deploy-check  Run deploy/check.sh against APP_DIR=$(APP_DIR)\n'
	@printf '  make drift-check   Detect systemd/check-out/build artifact drift\n'
	@printf '  make smoke         Run full post-deploy smoke test; set DOMAIN=your-host when auto-detect is not enough\n'
	@printf '  make smoke-systemd Run local systemd/port smoke only (no public reverse-proxy assumptions)\n'
	@printf '  make smoke-http    Run black-box public HTTP smoke only; set DOMAIN or SMOKE_PUBLIC_URL\n'
	@printf '  make installer-fakeroot Run isolated installer DESTDIR/fakeroot regression checks\n'
	@printf '  make status        Show systemd service status\n'
	@printf '  make logs          Tail recent application logs\n'
	@printf '  make package       Create a portable release archive\n'

verify:
	npm run verify

ci-local:
	bash scripts/ci-local.sh

ci-local-full:
	bash scripts/ci-local.sh --full

build:
	npm run build

runtime:
	npm run build:runtime

restart:
	@if command -v systemctl >/dev/null 2>&1; then \
		systemctl restart $(SERVICE_PREFIX)-next.service $(SERVICE_PREFIX)-ssh-ws.service; \
	else \
		echo 'systemctl not available'; exit 1; \
	fi

deploy-check:
	APP_DIR=$(APP_DIR) SERVICE_PREFIX=$(SERVICE_PREFIX) deploy/check.sh

drift-check:
	APP_DIR=$(APP_DIR) SERVICE_PREFIX=$(SERVICE_PREFIX) deploy/drift-check.sh

smoke:
	deploy/smoke-test.sh "$(DOMAIN)" "$(SERVICE_PREFIX)"

smoke-systemd:
	SMOKE_SCOPE=systemd deploy/smoke-test.sh "$(DOMAIN)" "$(SERVICE_PREFIX)"

smoke-http:
	SMOKE_SCOPE=http SMOKE_PUBLIC_URL="$(SMOKE_PUBLIC_URL)" deploy/smoke-test.sh "$(DOMAIN)" "$(SERVICE_PREFIX)"

installer-fakeroot:
	deploy/fakeroot-install-check.sh

status:
	@if command -v systemctl >/dev/null 2>&1; then \
		systemctl status $(SERVICE_PREFIX)-next.service $(SERVICE_PREFIX)-ssh-ws.service --no-pager; \
	else \
		echo 'systemctl not available'; exit 1; \
	fi

logs:
	journalctl -u $(SERVICE_PREFIX)-next.service -u $(SERVICE_PREFIX)-ssh-ws.service -n 120 --no-pager

package:
	deploy/package.sh
