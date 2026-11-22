import { ConflictError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { dockerExec, isDockerNoSuchContainerError, type DockerTarget } from "./docker-cli";

export const INSTANCE_LABEL = "com.vcontrolhub.quick-service.instance";
export const INSTALL_LABEL = "com.vcontrolhub.quick-service.install";

type OwnershipCheck = { storedId?: string | null; installId?: string; reconcile?: boolean };

export async function ownedContainer(target: DockerTarget, name: string, serviceId: string, check: OwnershipCheck) {
	const format = ['{{.Id}}', '{{index .Config.Labels "com.vcontrolhub.quick-service"}}',
		`{{index .Config.Labels "${INSTANCE_LABEL}"}}`, `{{index .Config.Labels "${INSTALL_LABEL}"}}`].join("|");
	let raw: string;
	try {
		raw = await dockerExec(target, ["inspect", "--type=container", "--format=" + format, name], 10_000);
	} catch (error) {
		if (isDockerNoSuchContainerError(error)) return null;
		throw error;
	}
	const [id, managed, instance, install] = raw.trim().split("|");
	const legacy = (!instance || instance === "<no value>") && check.storedId === id;
	const unexpectedId = check.storedId && check.storedId !== id && !check.reconcile;
	if (!id || !/^[a-f0-9]{64}$/.test(id) || managed !== "true" || (instance !== serviceId && !legacy) ||
		unexpectedId || (check.installId && install !== check.installId)) {
		throw new ConflictError(t("backend.quickService.targetMismatch"));
	}
	return id;
}
