import { readFileSync } from "node:fs";

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const packageJson = readJson("../package.json");
const packageLock = readJson("../package-lock.json");
const version = packageJson.version;
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (typeof version !== "string" || !semver.test(version)) {
	throw new Error(`package.json has an invalid SemVer version: ${String(version)}`);
}
if (packageLock.version !== version || packageLock.packages?.[""]?.version !== version) {
	throw new Error("package.json and package-lock.json versions do not match");
}
if (tag && tag !== `v${version}`) {
	throw new Error(`release tag ${tag} does not match package version v${version}`);
}

const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
if (!changelog.includes(`## [${version}]`)) {
	throw new Error(`CHANGELOG.md is missing a ## [${version}] section`);
}

console.log(`release-version-ok version=${version}${tag ? ` tag=${tag}` : ""}`);
