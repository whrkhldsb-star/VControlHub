export type Template = {
	id: string;
	name: string;
	description: string | null;
	command: string;
	rollbackCommand?: string | null;
	variables: string[];
	tags: string[];
	isBuiltin: boolean;
	createdAt: string;
	creator: { username: string; displayName: string | null } | null;
};

export type ServerOption = { id: string; name: string; enabled: boolean };

/** A template's fields as its form sends them. */
export type TemplateFields = {
	name: string;
	description: string;
	command: string;
	rollbackCommand: string | null;
	tags: string[];
};

/** The fields of an edited template that differ from the saved one: what the edit sends. An emptied description is sent as "", which clears it. */
export function changedTemplateFields(saved: Template, next: TemplateFields): Partial<TemplateFields> {
	const changes: Partial<TemplateFields> = {};
	if (next.name !== saved.name) changes.name = next.name;
	if (next.description !== (saved.description ?? "")) changes.description = next.description;
	if (next.command !== saved.command) changes.command = next.command;
	if (next.rollbackCommand !== (saved.rollbackCommand || null)) changes.rollbackCommand = next.rollbackCommand;
	if (next.tags.join("\n") !== saved.tags.join("\n")) changes.tags = next.tags;
	return changes;
}
