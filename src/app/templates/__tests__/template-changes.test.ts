import { describe, expect, it } from "vitest";

import { changedTemplateFields, type Template, type TemplateFields } from "../template-types";

const saved: Template = {
	id: "tmpl_1",
	name: "Compose update",
	description: "Pull and restart",
	command: "cd {{dir}} && docker compose up -d",
	rollbackCommand: null,
	variables: ["dir"],
	tags: ["deploy"],
	isBuiltin: false,
	createdAt: "2026-01-01T00:00:00.000Z",
	creator: null,
};

const unchanged = (): TemplateFields => ({ name: saved.name, description: "Pull and restart", command: saved.command, rollbackCommand: null, tags: ["deploy"] });

describe("changedTemplateFields", () => {
	it("finds nothing to send when nothing changed", () => {
		expect(changedTemplateFields(saved, unchanged())).toEqual({});
		// A template saved without a rollback field has none.
		expect(changedTemplateFields({ ...saved, rollbackCommand: undefined }, unchanged())).toEqual({});
	});

	it("sends what changed, an emptied description as empty", () => {
		expect(changedTemplateFields(saved, { ...unchanged(), description: "", tags: ["deploy", "docker"] })).toEqual({ description: "", tags: ["deploy", "docker"] });
		expect(changedTemplateFields(saved, { ...unchanged(), command: "docker compose pull", rollbackCommand: "docker compose down" }))
			.toEqual({ command: "docker compose pull", rollbackCommand: "docker compose down" });
		expect(changedTemplateFields({ ...saved, rollbackCommand: "docker compose down" }, unchanged())).toEqual({ rollbackCommand: null });
	});
});
