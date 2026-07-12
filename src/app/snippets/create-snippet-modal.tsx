"use client";

import { SnippetModal, type SnippetFormValue } from "./snippet-modal";

export function CreateSnippetModal({ onClose, onCreated }: {
	onClose: () => void;
	onCreated: (created: SnippetFormValue) => void;
}) {
	return <SnippetModal mode="create" onClose={onClose} onSaved={onCreated} />;
}
