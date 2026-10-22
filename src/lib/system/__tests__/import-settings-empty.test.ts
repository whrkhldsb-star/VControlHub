import { describe, expect, it, vi } from "vitest";

import type { ExportFile } from "@/lib/system/config-schema";
import type { Tx } from "../import-executors-helpers";
import { importSettings } from "../import-executors-config";

/**
 * Overwriting settings restores a value the source had cleared. Every empty
 * value used to be skipped, as if it were a secret a standard export blanks,
 * so a cleared alert recipient kept getting mail on the target.
 */
describe("importSettings with empty values", () => {
	it("clears a plain setting but keeps a secret the export left out", async () => {
		const update = vi.fn().mockResolvedValue({});
		const tx = {
			setting: {
				findMany: vi.fn().mockResolvedValue([{ key: "smtp.alertRecipients" }, { key: "smtp.password" }]),
				createMany: vi.fn().mockResolvedValue({ count: 0 }),
				update,
			},
		} as unknown as Tx;
		const counts = { created: 0, updated: 0, skipped: 0 };

		await importSettings(
			tx,
			{ settings: [{ key: "smtp.alertRecipients", value: "" }, { key: "smtp.password", value: "" }] } as unknown as ExportFile["tables"],
			{ dryRun: false, overwriteExisting: true, importUsers: false, importSettings: true },
			counts,
		);

		expect(update).toHaveBeenCalledOnce();
		expect(update).toHaveBeenCalledWith({ where: { key: "smtp.alertRecipients" }, data: { value: "", updatedBy: null } });
		expect(counts).toEqual({ created: 0, updated: 1, skipped: 1 });
	});
});
