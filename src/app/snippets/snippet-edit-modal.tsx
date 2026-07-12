"use client";

import { SnippetModal, type SnippetFormValue } from "./snippet-modal";

export function SnippetEditModal({ snippet, onClose, onSaved }: {
	snippet: SnippetFormValue;
	onClose: () => void;
	onSaved: (updated: SnippetFormValue) => void;
}) {
	return <SnippetModal mode="edit" snippet={snippet} onClose={onClose} onSaved={onSaved} />;
}
