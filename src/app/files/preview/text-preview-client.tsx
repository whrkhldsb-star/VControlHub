"use client";

import { DiffReviewDialog } from "./diff-review-dialog";
import { highlightLine } from "./syntax-highlighter";
import { TextPreviewBody, TextPreviewToolbar } from "./text-preview-renderers";
import { TextPreviewError, TextPreviewLoading } from "./text-preview-states";
import { highlightSearchTerm } from "./text-preview-highlight";
import { useTextPreviewController } from "./use-text-preview-controller";
import { useI18n } from "@/lib/i18n/use-locale";

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

	if (ctrl.state.loading) {
		return <TextPreviewLoading label={t("textPreview.loading")} />;
	}

	if (ctrl.state.error) {
		return <TextPreviewError message={ctrl.state.error} />;
	}

	if (!ctrl.sanitizeHighlight) {
		return <TextPreviewLoading label={t("textPreview.loading")} />;
	}

	const lines = ctrl.currentContent.split("\n");
	const totalLines = lines.length;
	const hasUnsavedChanges = ctrl.draft !== ctrl.currentContent;
	const highlightSearch = (html: string): string => highlightSearchTerm(html, ctrl.searchQuery);

	return (
		<div className="space-y-3">
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
				onCancelEdit={ctrl.cancelEdit}
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
				highlightSearch={highlightSearch}
				sanitizeHighlight={ctrl.sanitizeHighlight}
			/>
		</div>
	);
}
