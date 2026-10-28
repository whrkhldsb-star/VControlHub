"use client";

import { useMemo } from "react";
import { DiffReviewDialog } from "./diff-review-dialog";
import { highlightLine } from "./syntax-highlighter";
import { TextPreviewBody, TextPreviewToolbar } from "./text-preview-renderers";
import { TextPreviewError, TextPreviewLoading } from "./text-preview-states";
import { useTextPreviewController } from "./use-text-preview-controller";
import { useI18n } from "@/lib/i18n/use-locale";
import { useUnsavedChangesGuard } from "@/lib/forms/use-unsaved-changes-guard";
import { Notice } from "@/components/ui-primitives";
import { TEXT_PREVIEW_MAX_BYTES } from "@/lib/http/read-text-prefix";

export function TextPreviewClient({
	href,
	name,
	fileEntryId,
	editable = false,
	driver,
	nodeId,
	relativePath,
	serverId,
	reloadUnit,
	reloadKind,
}: {
	href: string;
	name?: string;
	fileEntryId?: string;
	editable?: boolean;
	driver?: string;
	nodeId?: string;
	relativePath?: string;
	serverId?: string;
	reloadUnit?: string;
	reloadKind?: "systemd" | "compose";
}) {
	const { t } = useI18n();
	const ctrl = useTextPreviewController({
		href,
		name,
		fileEntryId,
		editable,
		driver,
		nodeId,
		relativePath,
		serverId,
		reloadUnit,
		reloadKind,
		t,
	});

	// Stable between renders, so the body's per-line highlighting is reused.
	const lines = useMemo(() => ctrl.currentContent.split("\n"), [ctrl.currentContent]);

	// Editing nginx.conf or a compose file: a stray click on a link, Back or a reload used to throw the draft away
	// without a word. The same guard as the other editors asks first.
	const unsavedGuard = useUnsavedChangesGuard({ dirty: ctrl.editMode && ctrl.draft !== ctrl.currentContent });

	if (ctrl.state.loading) {
		return <TextPreviewLoading label={t("textPreview.loading")} />;
	}

	if (ctrl.state.error) {
		return <TextPreviewError message={ctrl.state.error} />;
	}

	if (ctrl.rendererFailed) {
		return <TextPreviewError message={t("textPreview.rendererLoadFailed")} />;
	}

	if (!ctrl.sanitizeHighlight) {
		return <TextPreviewLoading label={t("textPreview.loading")} />;
	}

	const totalLines = lines.length;
	const hasUnsavedChanges = ctrl.draft !== ctrl.currentContent;

	return (
		<div className="space-y-3">
			{ctrl.state.truncated ? (
				<Notice tone="warning">{t("textPreview.prefixOnly", { size: TEXT_PREVIEW_MAX_BYTES / 1024 / 1024 })}</Notice>
			) : null}
			<TextPreviewToolbar
				t={t}
				lang={ctrl.lang}
				totalLines={totalLines}
				canEdit={ctrl.canEdit}
				editMode={ctrl.editMode}
				saveStatus={ctrl.saveStatus}
				saveMessage={ctrl.saveMessage}
				reloadMessage={ctrl.reloadMessage}
				hasUnsavedChanges={hasUnsavedChanges}
				canReloadAfterSave={ctrl.canReloadAfterSave}
				reloadKind={reloadKind}
				reloadUnit={reloadUnit}
				searchQuery={ctrl.searchQuery}
				jumpLine={ctrl.jumpLine}
				setSearchQuery={ctrl.setSearchQuery}
				setJumpLine={ctrl.setJumpLine}
				onJumpToLine={ctrl.handleJumpToLine}
				onPreviewSave={() => ctrl.setShowDiffReview(true)}
				onSaveAndReload={ctrl.handleSaveAndReload}
				onCancelEdit={() => unsavedGuard.requestAction(ctrl.cancelEdit)}
				onOpenEditorFind={() => ctrl.setEditorFind({ open: true, query: "", total: 0, current: 0 })}
				onEnterEditMode={() => ctrl.setEditMode(true)}
			/>

			{ctrl.editMode && ctrl.showDiffReview ? (
				<DiffReviewDialog
					diffRows={ctrl.diffRows}
					diffSummary={ctrl.diffSummary}
					saveStatus={ctrl.saveStatus}
					canReloadAfterSave={ctrl.canReloadAfterSave}
					reloadKind={reloadKind}
					reloadUnit={reloadUnit}
					onClose={() => ctrl.setShowDiffReview(false)}
					onSave={ctrl.handleSave}
					onSaveAndReload={ctrl.handleSaveAndReload}
				/>
			) : null}

			<TextPreviewBody
				t={t}
				editMode={ctrl.editMode}
				editorFind={ctrl.editorFind}
				draft={ctrl.draft}
				lines={lines}
				lang={ctrl.lang}
				showDiffReview={ctrl.showDiffReview}
				editorFindInputRef={ctrl.editorFindInputRef}
				gutterRef={ctrl.gutterRef}
				editorRef={ctrl.editorRef}
				containerRef={ctrl.containerRef}
				lineRef={ctrl.lineRef}
				setDraft={ctrl.setDraft}
				setSaveStatus={ctrl.setSaveStatus}
				setSaveMessage={ctrl.setSaveMessage}
				setShowDiffReview={ctrl.setShowDiffReview}
				onQueryChange={ctrl.updateEditorFindQuery}
				onMove={ctrl.moveEditorFind}
				onCloseFind={ctrl.closeEditorFind}
				onEditorScroll={ctrl.handleEditorScroll}
				onEditorKeyDown={ctrl.handleEditorKeyDown}
				highlightLine={highlightLine}
				searchQuery={ctrl.searchQuery}
				sanitizeHighlight={ctrl.sanitizeHighlight}
			/>
			{unsavedGuard.discardDialog}
		</div>
	);
}
