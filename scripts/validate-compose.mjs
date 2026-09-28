#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";

const file = resolve(process.argv[2] ?? "docker-compose.yml");
const document = load(readFileSync(file, "utf8"));

function fail(message) {
	throw new Error(`compose validation failed: ${message}`);
}

if (!document || typeof document !== "object" || Array.isArray(document)) fail("root must be a mapping");
const services = document.services;
if (!services || typeof services !== "object" || Array.isArray(services)) fail("services mapping is required");
for (const required of ["postgres", "app"]) {
	if (!services[required] || typeof services[required] !== "object") fail(`missing service: ${required}`);
}

const postgres = services.postgres;
if (typeof postgres.image !== "string" || !postgres.image.startsWith("postgres:")) fail("postgres service must use a postgres image");
if (!postgres.healthcheck?.test) fail("postgres healthcheck is required");

const app = services.app;
if (!app.build && !app.image) fail("app service requires build or image");
if (app.depends_on?.postgres?.condition !== "service_healthy") fail("app must wait for healthy postgres");
if (!app.healthcheck?.test) fail("app healthcheck is required");
// Single published port: the SSH gateway stays loopback inside the container
// and the web server forwards /ssh upgrades to it, so publishing only the app
// port is the supported topology. Publishing the gateway port directly is
// rejected as an accidental re-exposure.
if (!Array.isArray(app.ports) || app.ports.length < 1) fail("app must publish its web port");
for (const mapping of app.ports) {
	const published = String(mapping).split(":")[0];
	if (String(mapping).includes(":3001") || /3001$/.test(published)) {
		fail("SSH gateway port must not be published; /ssh is forwarded by the web server");
	}
}
if (app.environment?.SSH_WS_HOST && app.environment.SSH_WS_HOST !== "127.0.0.1") {
	fail("SSH gateway must bind 127.0.0.1 inside the container (in-process /ssh forwarding covers it)");
}

const environment = app.environment;
for (const key of ["DATABASE_URL", "AUTH_SESSION_SECRET", "ENCRYPTION_KEY", "SSH_WS_SECRET"]) {
	if (!environment || typeof environment[key] !== "string" || !environment[key].trim()) fail(`app environment is missing ${key}`);
}

const volumes = document.volumes;
if (!volumes || typeof volumes !== "object") fail("top-level volumes mapping is required");
for (const mount of app.volumes ?? []) {
	if (typeof mount !== "string" || mount.startsWith("/")) continue;
	const name = mount.split(":", 1)[0];
	if (name && !(name in volumes)) fail(`named volume ${name} is not declared`);
}

console.log(`compose-offline-ok ${file}`);
