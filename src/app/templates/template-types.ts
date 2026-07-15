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
