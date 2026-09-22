"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useToast } from "@/components/toast-provider";
import { escapeHtml } from "@/lib/sanitize/escape-html";

import {
	getErrorMessage,
	type ImageItem,
	type ImageStats,
	type PendingDelete,
	type UploadProgress,
} from "./image-bed-types";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

export type PublishForm = {
	storageNodeId: string;
	relativePath: string;
	filename: string;
	album: string;
};

const EMPTY_PUBLISH_FORM: PublishForm = {
	storageNodeId: "",
	relativePath: "",
	filename: "",
	album: "",
};

/**
 * Business actions for the image-bed page.
 * Keeps network + selection/upload state out of the page shell so the
 * client component is mostly layout composition.
 */
export function useImageBedActions({
	t,
	search,
	page,
	showAll,
	images,
	fetchImages,
}: {
	t: TFn;
	search: string;
	page: number;
	showAll: boolean;
	images: ImageItem[];
	fetchImages: (p?: number) => Promise<void> | void;
}) {
	const [uploading, setUploading] = useState(false);
	const [dragOver, setDragOver] = useState(false);
	const [previewImage, setPreviewImage] = useState<ImageItem | null>(null);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	// Clear batch selection when page/filter changes so counts stay page-scoped.
	useEffect(() => {
		setSelectedIds(new Set());
	}, [page, search, showAll]);
	const [showStats, setShowStats] = useState(false);
	const [stats, setStats] = useState<ImageStats | null>(null);
	const [batchMode, setBatchMode] = useState(false);
	const [batchAlbum, setBatchAlbum] = useState("");
	const [showPublishModal, setShowPublishModal] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const deletingRef = useRef(false);
	const [batchBusy, setBatchBusy] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const [showLegacyUpload, setShowLegacyUpload] = useState(false);
	const [storageNodes, setStorageNodes] = useState<Array<{ id: string; name: string }>>([]);
	const [publishForm, setPublishForm] = useState<PublishForm>(EMPTY_PUBLISH_FORM);
	const [uploadProgress, setUploadProgress] = useState<UploadProgress>(null);
	const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const batchBusyRef = useRef(false);
	const publishingRef = useRef(false);
	const uploadingRef = useRef(false);
	// Global toast system (root ToastProvider) — same surface every other page
	// uses, instead of a page-local floating toast with its own timer.
	const { addToast } = useToast();

	const showToast = useCallback((msg: string, tone: "status" | "alert" = "status") => {
		addToast(tone === "alert" ? "error" : "success", msg);
	}, [addToast]);

	const fetchStats = useCallback(async () => {
		try {
			const data = (await csrfFetch("/api/images/stats")) as ImageStats;
			setStats(data);
			setShowStats(true);
		} catch {
			showToast(t("imageBed.toast.fetchStatsFailed"));
		}
	}, [showToast, t]);

	const fetchStorageNodes = useCallback(async () => {
		try {
			const data = await csrfFetch("/api/storage/nodes");
			const nodes = (data.nodes || data || []).map(
				(n: { id: string; name: string; driver?: string; serverName?: string | null }) => ({
					id: n.id,
					name: n.serverName ? `${n.name} · ${n.serverName}` : n.name,
				}),
			);
			if (nodes.length === 0) showToast(t("imageBed.toast.noPublishNodes"));
			else setStorageNodes(nodes);
		} catch (err) {
			showToast(getErrorMessage(err, t("imageBed.toast.fetchNodesFailed")));
		}
	}, [showToast, t]);

	const handleUpload = useCallback(
		async (files: FileList | File[]) => {
			if (uploadingRef.current) return;
			const uploadItems = Array.from(files);
			if (uploadItems.length === 0) return;

			uploadingRef.current = true;
			setUploading(true);
			setUploadProgress({
				total: uploadItems.length,
				current: 0,
				success: 0,
				failure: 0,
				queue: uploadItems.map((file) => ({
					name: file.name,
					status: "pending",
					message: t("imageBedPage.queue.pending"),
				})),
			});

			let success = 0;
			let failure = 0;
			for (let index = 0; index < uploadItems.length; index++) {
				const file = uploadItems[index]!;
				setUploadProgress((prev) =>
					prev
						? {
								...prev,
								current: index + 1,
								queue: prev.queue.map((item, i) =>
									i === index
										? {
												...item,
												status: "uploading",
												message: t("imageBedPage.queue.uploadingItem", { current: index + 1, total: uploadItems.length }),
											}
										: item,
								),
							}
						: prev,
				);

				if (!file.type.startsWith("image/")) {
					failure++;
					setUploadProgress((prev) =>
						prev
							? {
									...prev,
									failure,
									queue: prev.queue.map((item, i) =>
										i === index
											? { ...item, status: "skipped", message: t("imageBedPage.queue.notImage") }
											: item,
									),
								}
							: prev,
					);
					continue;
				}
				if (file.size > 20 * 1024 * 1024) {
					failure++;
					setUploadProgress((prev) =>
						prev
							? {
									...prev,
									failure,
									queue: prev.queue.map((item, i) =>
										i === index
											? { ...item, status: "error", message: t("imageBedPage.queue.tooLarge") }
											: item,
									),
								}
							: prev,
					);
					continue;
				}

				const formData = new FormData();
				formData.append("file", file);
				// Upload album comes from the dedicated album field, NOT from the
				// search box. `search` is a substring query matched against
				// filename/relativePath/album (see /api/images/list), so reusing it
				// here filed uploads into an album literally named after whatever the
				// user last typed to *find* something — e.g. searching "cover" then
				// dropping files created an album called "cover".
				if (publishForm.album.trim()) formData.append("album", publishForm.album.trim());
				if (publishForm.storageNodeId) formData.append("storageNodeId", publishForm.storageNodeId);
				if (publishForm.relativePath) formData.append("relativePath", publishForm.relativePath);
				try {
					await csrfFetch("/api/images/upload", { method: "POST", body: formData });
					success++;
					setUploadProgress((prev) =>
						prev
							? {
									...prev,
									success,
									queue: prev.queue.map((item, i) =>
										i === index
											? { ...item, status: "success", message: t("imageBedPage.queue.success") }
											: item,
									),
								}
							: prev,
					);
				} catch (error) {
					failure++;
					const errorMessage = getErrorMessage(error, t("imageBedPage.error.upload"));
					setUploadProgress((prev) =>
						prev
							? {
									...prev,
									failure,
									queue: prev.queue.map((item, i) =>
										i === index
											? {
													...item,
													status: "error",
													message: t("imageBedPage.queue.failedPrefix").replace(
														"{message}",
														errorMessage,
													),
												}
											: item,
									),
								}
							: prev,
					);
				}
			}

			uploadingRef.current = false;
			setUploading(false);
			if (fileInputRef.current) fileInputRef.current.value = "";
			if (success > 0 && failure === 0) {
				showToast(t("imageBedPage.summary.successAll", { count: success }));
				void fetchImages(1);
			} else if (success > 0) {
				showToast(
					t("imageBedPage.summary.partial", { success, total: uploadItems.length, failure }),
					"alert",
				);
				void fetchImages(1);
			} else {
				showToast(
					t("imageBedPage.summary.allFailed", { failure, total: uploadItems.length }),
					"alert",
				);
			}
		},
		[fetchImages, publishForm.album, publishForm.relativePath, publishForm.storageNodeId, showToast, t],
	);

	const requestDelete = useCallback((img: ImageItem) => {
		setPendingDelete({ type: "single", id: img.id, filename: img.filename });
	}, []);

	const requestBatchDelete = useCallback(() => {
		if (selectedIds.size === 0) {
			showToast(t("imageBed.toast.selectFirst"));
			return;
		}
		setPendingDelete({ type: "batch", count: selectedIds.size });
	}, [selectedIds.size, showToast, t]);

	const runBatchAction = useCallback(
		async (action: "delete" | "moveAlbum" | "togglePublic") => {
			if (selectedIds.size === 0) {
				showToast(t("imageBed.toast.selectFirst"));
				return false;
			}
			if (batchBusyRef.current) return false;
			batchBusyRef.current = true;
			setBatchBusy(true);
			try {
				const body: Record<string, unknown> = { action, ids: Array.from(selectedIds) };
				if (action === "moveAlbum") body.album = batchAlbum;
				const data = await csrfFetch("/api/images/batch", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				});
				showToast(
					t("imageBedPage.batchSuccess").replace(
						"{count}",
						String(data.deleted || data.updated || 0),
					),
				);
				setSelectedIds(new Set());
				setBatchMode(false);
				void fetchImages(page);
				return true;
			} catch {
				showToast(t("imageBed.toast.batchError"), "alert");
				return false;
			} finally {
				batchBusyRef.current = false;
				setBatchBusy(false);
			}
		},
		[batchAlbum, fetchImages, page, selectedIds, showToast, t],
	);

	const confirmDelete = useCallback(async () => {
		// `deleting` is state, so it is stale for the whole tick in which the first
		// confirm fired — two calls in one tick would both pass and issue two
		// DELETEs for the same image (the second answering 404). `deletingRef` is
		// synchronously correct. The dialog already disables its confirm button on
		// `busy`, so this is not reachable through the UI; it hardens the hook for
		// programmatic callers, and mirrors `batchBusyRef` two functions below.
		if (!pendingDelete || deleting || deletingRef.current) return;
		deletingRef.current = true;
		setDeleting(true);
		const target = pendingDelete;
		// Keep pendingDelete until the request finishes so DeleteImageDialog
		// can show the busy label and block backdrop dismiss while in-flight.
		if (target.type === "single") {
			try {
				await csrfFetch(`/api/images/${target.id}`, { method: "DELETE" });
				showToast(t("imageBed.toast.deleted"));
				setPreviewImage(null);
				setPendingDelete(null);
				void fetchImages(page);
			} catch {
				showToast(t("imageBed.toast.deleteError"));
			} finally {
				deletingRef.current = false;
				setDeleting(false);
			}
			return;
		}
		try {
			if (await runBatchAction("delete")) setPendingDelete(null);
		} finally {
			deletingRef.current = false;
			setDeleting(false);
		}
	}, [deleting, fetchImages, page, pendingDelete, runBatchAction, showToast, t]);

	const handlePublishFromStorage = useCallback(async () => {
		if (publishingRef.current) return;
		publishingRef.current = true;
		setPublishing(true);
		try {
			await csrfFetch("/api/images/publish-from-storage", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(publishForm),
			});
			showToast(t("imageBed.toast.published"));
			setShowPublishModal(false);
			setPublishForm(EMPTY_PUBLISH_FORM);
			void fetchImages(1);
		} catch (err) {
			showToast(getErrorMessage(err, t("imageBed.toast.publishError")));
		} finally {
			publishingRef.current = false;
			setPublishing(false);
		}
	}, [fetchImages, publishForm, showToast, t]);

	const toggleSelect = useCallback((id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const selectAll = useCallback(() => {
		if (images.length === 0) return;
		setSelectedIds((prev) =>
			prev.size === images.length ? new Set() : new Set(images.map((i) => i.id)),
		);
	}, [images]);

	const toggleBatchMode = useCallback(() => {
		setBatchMode((prev) => {
			const next = !prev;
			if (!next) setSelectedIds(new Set());
			else setSelectedIds(new Set());
			return next;
		});
	}, []);

	const copyText = useCallback(async (text: string, successKey: string) => {
		try {
			await navigator.clipboard.writeText(text);
			showToast(t(successKey));
		} catch {
			showToast(t("imageBed.toast.copyFailed"), "alert");
		}
	}, [showToast, t]);

	const copyLink = useCallback((url: string) =>
		copyText(`${window.location.origin}${url}`, "imageBed.toast.urlCopied"), [copyText]);

	const copyMarkdown = useCallback(
		(img: ImageItem) => {
			const fullUrl = `${window.location.origin}${img.publicUrl}`;
			const label = escapeHtml(img.filename).replace(/[[\]\\]/g, "\\$&").replace(/[\r\n]/g, " ");
			return copyText(`![${label}](${fullUrl})`, "imageBed.toast.markdownCopied");
		},
		[copyText],
	);

	const copyHTML = useCallback(
		(img: ImageItem) => {
			const fullUrl = `${window.location.origin}${img.publicUrl}`;
			return copyText(`<img src="${escapeHtml(fullUrl)}" alt="${escapeHtml(img.filename)}" />`, "imageBed.toast.htmlCopied");
		},
		[copyText],
	);

	const openPublishModal = useCallback(() => {
		void fetchStorageNodes();
		setShowPublishModal(true);
	}, [fetchStorageNodes]);

	return {
		// state
		uploading,
		dragOver,
		setDragOver,
		previewImage,
		setPreviewImage,
		selectedIds,
		showStats,
		setShowStats,
		stats,
		batchMode,
		batchAlbum,
		setBatchAlbum,
		showPublishModal,
		setShowPublishModal,
		deleting,
		batchBusy,
		publishing,
		showLegacyUpload,
		setShowLegacyUpload,
		storageNodes,
		publishForm,
		setPublishForm,
		uploadProgress,
		pendingDelete,
		setPendingDelete,
		fileInputRef,
		// actions
		showToast,
		fetchStats,
		fetchStorageNodes,
		handleUpload,
		requestDelete,
		requestBatchDelete,
		confirmDelete,
		runBatchAction,
		handlePublishFromStorage,
		toggleSelect,
		selectAll,
		toggleBatchMode,
		copyLink,
		copyMarkdown,
		copyHTML,
		openPublishModal,
	};
}
