const DEFAULT_APP_NAME = "VControlHub";
const DEFAULT_SITE_NAME = "VPS Unified Control Platform";
const DEFAULT_PUBLIC_LABEL = "VPS Management & Distributed Cloud Drive";
const DEFAULT_DESCRIPTION = "Unified VPS management, approval-based command execution, distributed cloud drive, and media browsing platform";
// Direct NEXT_PUBLIC_* property access is required for Next.js to inline the
// same value into client bundles. Reading it through a dynamic env object
// makes the browser fall back to English while SSR uses the configured value.
const PUBLIC_LABEL_ENV = process.env.NEXT_PUBLIC_APP_PUBLIC_LABEL;
const PUBLIC_DESCRIPTION_ENV = process.env.NEXT_PUBLIC_APP_DESCRIPTION;

function slugifyAppName(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || DEFAULT_APP_NAME;
}

function readTrimmed(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeToken(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "");
}

function isInstallDomainLabel(value: string, env: NodeJS.ProcessEnv) {
  const slug = getAppSlug(env).toLowerCase();
  const host = value.trim().toLowerCase();
  const configuredDomains = [env.APP_DOMAIN, env.DOMAIN]
    .map((item) => item?.trim().toLowerCase())
    .filter((item): item is string => Boolean(item));
  return (
    host === slug ||
    host.startsWith(`${slug}.`) ||
    configuredDomains.includes(host)
  );
}

export function getAppName(env: NodeJS.ProcessEnv = process.env) {
  return readTrimmed(env.APP_NAME) || DEFAULT_APP_NAME;
}

export function getAppSlug(env: NodeJS.ProcessEnv = process.env) {
  return slugifyAppName(env.APP_SLUG || env.APP_NAME || DEFAULT_APP_NAME);
}

export function getSiteName(env: NodeJS.ProcessEnv = process.env) {
  return readTrimmed(env.SITE_NAME) || DEFAULT_SITE_NAME;
}

export function getPublicLabel(env?: NodeJS.ProcessEnv) {
	const sourceEnv = env ?? process.env;
	const trimmed = readTrimmed(env ? env.NEXT_PUBLIC_APP_PUBLIC_LABEL : PUBLIC_LABEL_ENV);
  if (!trimmed) {
    return DEFAULT_PUBLIC_LABEL;
  }

  const normalized = normalizeToken(trimmed);
	const appNameNormalized = normalizeToken(getAppName(sourceEnv));
	const appSlugNormalized = normalizeToken(getAppSlug(sourceEnv));
	if (normalized === appNameNormalized || normalized === appSlugNormalized || isInstallDomainLabel(trimmed, sourceEnv)) {
    return DEFAULT_PUBLIC_LABEL;
  }

  return trimmed;
}

export function getAppDescription(env?: NodeJS.ProcessEnv) {
	return readTrimmed(env ? env.NEXT_PUBLIC_APP_DESCRIPTION : PUBLIC_DESCRIPTION_ENV) || DEFAULT_DESCRIPTION;
}

export function getAppMetadataTitle(env: NodeJS.ProcessEnv = process.env) {
	return `${getSiteName(env)} | ${getAppDescription(env)}`;
}
