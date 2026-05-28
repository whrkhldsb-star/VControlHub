APP_DIR ?= $(CURDIR)
DOMAIN ?= whrkhldsb.qzz.io
SERVICE_PREFIX ?= vcontrolhub

.PHONY: help verify build runtime deploy-check smoke restart status logs package

help:
	@printf 'VControlHub maintenance targets:\n'
	@printf '  make verify        Run prisma generate, typecheck, lint, tests, Next build and runtime bundle\n'
	@printf '  make build         Run Next.js production build\n'
	@printf '  make runtime       Build dist/server.js and dist/ssh-ws-proxy.js\n'
	@printf '  make restart       Restart $(SERVICE_PREFIX)-next and $(SERVICE_PREFIX)-ssh-ws when available\n'
	@printf '  make deploy-check  Run deploy/check.sh against APP_DIR=$(APP_DIR)\n'
	@printf '  make smoke         Run post-deploy smoke test for DOMAIN=$(DOMAIN)\n'
	@printf '  make status        Show systemd service status\n'
	@printf '  make logs          Tail recent application logs\n'
	@printf '  make package       Create a portable release archive\n'

verify:
	npm run verify

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

smoke:
	deploy/smoke-test.sh $(DOMAIN) $(SERVICE_PREFIX)

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
