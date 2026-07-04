export type PreviewState = { loading: true } | { loading: false; content: string | null; error: string | null };
export type PreviewMetaState = {
	editMode: boolean;
	showDiffReview: boolean;
	saveStatus: "idle" | "saving" | "saved" | "reloading" | "reloaded" | "error";
	saveMessage: string;
	reloadMessage: string;
};

export const INITIAL_PREVIEW_META: PreviewMetaState = {
	editMode: false,
	showDiffReview: false,
	saveStatus: "idle",
	saveMessage: "",
	reloadMessage: "",
};

export type DiffRow = { line: number; before: string; after: string; kind: "added" | "removed" | "changed" };

export type EditorFindState = {
	open: boolean;
	query: string;
	total: number;
	current: number;
};

export const INITIAL_EDITOR_FIND: EditorFindState = {
	open: false,
	query: "",
	total: 0,
	current: 0,
};

export type EditableDraft = {
	content: string;
	byteSize: number;
	lastModifiedMs?: number | null;
	updatedAt?: string | null;
};

export type SaveResponse = {
	success: boolean;
	file: {
		byteSize: number;
		previousByteSize?: number;
		lastModifiedMs?: number | null;
		updatedAt?: string | null;
	};
};
