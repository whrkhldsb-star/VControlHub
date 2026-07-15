"use client";

import { useCallback, useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";

import {
	getErrorMessage,
	type ImageItem,
	type ImageStats,
	type PendingDelete,
	type UploadProgress,
} from "./image-bed-types";

type TFn = (key: string) => string;
type ToastTone = "status" | "alert";

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
	images,
	fetchImages,
}: {
	t: TFn;
	search: string;
	page: number;
	images: ImageItem[];
	fetchImages: (p?: number) => Promise<void> | void;
}) {
	const [uploading, setUploading] = useState(false);
	const [dragOver, setDragOver] = useState(false);
	const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);
	const [previewImage, setPreviewImage] = useState<ImageItem | null>(null);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [showStats, setShowStats] = useState(false);
	const [stats, setStats] = useState<ImageStats | null>(null);
	const [batchMode, setBatchMode] = useState(false);
	const [batchAlbum, setBatchAlbum] = useState("");
	const [showPublishModal, setShowPublishModal] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [showLegacyUpload, setShowLegacyUpload] = useState(false);
	const [storageNodes, setStorageNodes] = useState<Array<{ id: string; name: string }>>([]);
	const [publishForm, setPublishForm] = useState<PublishForm>(EMPTY_PUBLISH_FORM);
	const [uploadProgress, setUploadProgress] = useState<UploadProgress>(null);
	const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const showToast = useCallback((msg: string, tone: ToastTone = "status") => {
		setToast({ message: msg, tone });
		setTimeout(() => setToast(null), 3000);
	}, []);

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
			showToast(err instanceof Error ? err.message : t("imageBed.toast.fetchNodesFailed"));
		}
	}, [showToast, t]);

	const handleUpload = useCallback(
		async (files: FileList | File[]) => {
			const uploadItems = Array.from(files);
			if (uploadItems.length === 0) return;

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
												message: t("imageBedPage.queue.uploadingItem")
													.replace("{current}", String(index + 1))
													.replace("{total}", String(uploadItems.length)),
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
				if (search) formData.append("album", search);
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

			setUploading(false);
			if (fileInputRef.current) fileInputRef.current.value = "";
			if (success > 0 && failure === 0) {
				showToast(t("imageBedPage.summary.successAll").replace("{count}", String(success)));
				void fetchImages(1);
			} else if (success > 0) {
				showToast(
					t("imageBedPage.summary.partial")
						.replace("{success}", String(success))
						.replace("{total}", String(uploadItems.length))
						.replace("{failure}", String(failure)),
					"alert",
				);
				void fetchImages(1);
			} else {
				showToast(
					t("imageBedPage.summary.allFailed")
						.replace("{failure}", String(failure))
						.replace("{total}", String(uploadItems.length)),
					"alert",
				);
			}
		},
		[fetchImages, publishForm.relativePath, publishForm.storageNodeId, search, showToast, t],
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
				return;
			}
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
			} catch {
				showToast(t("imageBed.toast.batchError"));
			}
		},
		[batchAlbum, fetchImages, page, selectedIds, showToast, t],
	);

	const confirmDelete = useCallback(async () => {
		if (!pendingDelete || deleting) return;
		setDeleting(true);
		const target = pendingDelete;
		setPendingDelete(null);
		if (target.type === "single") {
			try {
				await csrfFetch(`/api/images/${target.id}`, { method: "DELETE" });
				showToast(t("imageBed.toast.deleted"));
				setPreviewImage(null);
				void fetchImages(page);
			} catch {
				showToast(t("imageBed.toast.deleteError"));
			} finally {
				setDeleting(false);
			}
			return;
		}
		await runBatchAction("delete");
		setDeleting(false);
	}, [deleting, fetchImages, page, pendingDelete, runBatchAction, showToast, t]);

	const handlePublishFromStorage = useCallback(async () => {
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
			showToast(err instanceof Error ? err.message : t("imageBed.toast.publishError"));
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

	const copyLink = useCallback(
		(url: string) => {
			const fullUrl = `${window.location.origin}${url}`;
			void navigator.clipboard
				.writeText(fullUrl)
				.then(
					() => showToast(t("imageBed.toast.urlCopied")),
					() => showToast(t("imageBed.toast.copyFailed")),
				);
		},
		[showToast, t],
	);

	const copyMarkdown = useCallback(
		(img: ImageItem) => {
			const fullUrl = `${window.location.origin}${img.publicUrl}`;
			void navigator.clipboard
				.writeText(`![${img.filename}](${fullUrl})`)
				.then(
					() => showToast(t("imageBed.toast.markdownCopied")),
					() => showToast(t("imageBed.toast.copyFailed")),
				);
		},
		[showToast, t],
	);

	const copyHTML = useCallback(
		(img: ImageItem) => {
			const fullUrl = `${window.location.origin}${img.publicUrl}`;
			void navigator.clipboard
				.writeText(`<img src="${fullUrl}" alt="${img.filename}" />`)
				.then(
					() => showToast(t("imageBed.toast.htmlCopied")),
					() => showToast(t("imageBed.toast.copyFailed")),
				);
		},
		[showToast, t],
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
		toast,
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
