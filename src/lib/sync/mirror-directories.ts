import path from "node:path/posix";
import { syncEndpointsOverlap } from "./bidirectional";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

// Run in the inspected cwd. mountinfo identifies the backing directory even across bind mounts.
export const describeMirrorDirectory = [
	"echo VCH_SYNC_DIRECTORY",
	"exec 7<. && cat /proc/sys/kernel/random/boot_id || exit 1",
	`awk 'NR == FNR {if ($1 == "mnt_id:") m=$2; next} $1 == m {print $3,$4,$5; found=1; exit} END {if (!found) exit 1}' /proc/self/fdinfo/7 /proc/self/mountinfo || exit 1`,
	"while :; do stat -Lc '%d:%i' . || exit 1; [ . -ef / ] && break; cd -P .. || exit 1; done",
].join("\n");

function parseDirectory(directory: string, output: string) {
	const [boot, mount, ...ancestors] = output.split("\nVCH_SYNC_DIRECTORY\n")[1]?.trimEnd().split("\n") ?? [];
	const [device, root, mountPoint] = (mount ?? "").split(" ").map(field =>
		field.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8))));
	if (!boot || !/^[\da-f-]{36}$/i.test(boot) || !device || !/^\d+:\d+$/.test(device)
		|| !root?.startsWith("/") || !mountPoint?.startsWith("/") || !ancestors.length
		|| ancestors.some(id => !/^\d+:\d+$/.test(id))) throw new Error("Missing mirror directory identity");
	const relative = path.relative(mountPoint, directory);
	if (relative === ".." || relative.startsWith("../")) throw new Error("Mirror directory moved during inspection");
	return { boot, device, path: path.join(root, relative), ancestors, id: ancestors[0]! };
}

export function mirrorDirectoryIdentities(sourcePath: string, sourceOutput: string, targetPath: string, targetOutput: string) {
	const source = parseDirectory(sourcePath, sourceOutput);
	const target = parseDirectory(targetPath, targetOutput);
	if (source.boot === target.boot && (source.ancestors.includes(target.id) || target.ancestors.includes(source.id)
		|| syncEndpointsOverlap({ sourceServerId: source.device, targetServerId: target.device, sourcePath: source.path, targetPath: target.path }))) {
		throw new ValidationError(t("backend.sync.sourceAndTargetEndpointsMustDiffer"));
	}
	return { sourceIdentity: source.id, targetIdentity: target.id };
}
