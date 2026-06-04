const DEFAULT_APP_NAME = "VControlHub";
const DEFAULT_SITE_NAME = "VPS 统一管控平台";
const DEFAULT_PUBLIC_LABEL = "VPS 管理与分布式云盘";
const DEFAULT_DESCRIPTION = "统一 VPS 管理、审批执行、分布式云盘与媒体浏览平台";

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

export function getPublicLabel(env: NodeJS.ProcessEnv = process.env) {
  const trimmed = readTrimmed(env.NEXT_PUBLIC_APP_PUBLIC_LABEL);
  if (!trimmed) {
    return DEFAULT_PUBLIC_LABEL;
  }

  const normalized = normalizeToken(trimmed);
  const appNameNormalized = normalizeToken(getAppName(env));
  const appSlugNormalized = normalizeToken(getAppSlug(env));
  if (normalized === appNameNormalized || normalized === appSlugNormalized || isInstallDomainLabel(trimmed, env)) {
    return DEFAULT_PUBLIC_LABEL;
  }

  return trimmed;
}

export function getAppDescription(env: NodeJS.ProcessEnv = process.env) {
	return readTrimmed(env.NEXT_PUBLIC_APP_DESCRIPTION) || DEFAULT_DESCRIPTION;
}

export function getAppMetadataTitle(env: NodeJS.ProcessEnv = process.env) {
	return `${getSiteName(env)} | ${getAppDescription(env)}`;
}
