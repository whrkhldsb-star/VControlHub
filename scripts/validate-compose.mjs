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
if (!Array.isArray(app.ports) || app.ports.length < 2) fail("app must publish web and SSH-WS ports");

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
