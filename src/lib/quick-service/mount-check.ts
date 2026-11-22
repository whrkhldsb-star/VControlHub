import { dockerExec, type DockerTarget } from "./docker-cli";

// Run on the daemon's filesystem, also when the Hub itself runs inside a container.
// The fixed multi-architecture BusyBox image only performs metadata checks, with no network or capabilities.
const CHECK_IMAGE = "busybox@sha256:a7dbc319b1438115a207e11930dc4bb3e643dcb3ec0bdd694bb36cd8fad289ec";
const CHECK_MOUNTS = `set -eu
for source do
  current=/host
  remaining=\${source#/}
  while [ -n "$remaining" ]; do
    [ -d "$current" ] && [ -x "$current" ] || exit 1
    owner=$(stat -c %u "$current")
    mode=$(stat -c %a "$current")
    [ "$owner" = 0 ] && [ $((0$mode & 022)) -eq 0 ] || exit 1
    component=\${remaining%%/*}
    if [ "$component" = "$remaining" ]; then remaining=; else remaining=\${remaining#*/}; fi
    current="$current/$component"
    [ ! -L "$current" ] || exit 1
    # Docker creates missing components as root beneath this protected parent.
    [ -e "$current" ] || break
  done
done`;

export async function verifyDockerMounts(target: DockerTarget, sources: string[]) {
	if (!sources.length) return;
	await dockerExec(target, ["run", "--rm", "--network=none", "--read-only", "--cap-drop=ALL",
		"--security-opt=no-new-privileges", "--mount", "type=bind,src=/,dst=/host,readonly",
		CHECK_IMAGE, "sh", "-c", CHECK_MOUNTS, "verify-mounts", ...new Set(sources)], 60_000);
}
