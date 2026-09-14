"use client";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { ApiError } from "@/lib/http/api-client";
import {
  cancelStorageFileUpload,
  STORAGE_CHUNKED_THRESHOLD_BYTES,
  uploadStorageFileChunked,
} from "./storage-chunked-upload";

export type UploadState =
  | "pending"
  | "uploading"
  | "finalizing"
  | "paused"
  | "cancelled"
  | "success"
  | "error"
  | "cancel-error"
  | "unknown";
export type QueuedUpload = {
  id: string;
  name: string;
  nodeId: string;
  path: string;
  size: number;
  state: UploadState;
  percent: number;
  error?: string;
};
type UploadRecord = {
  file: File;
  controller?: AbortController;
  cancelRequested?: boolean;
};
export type UploadResult = { relativePath: string; size: number };

/** Browser-owned transfer queue. File objects survive SPA route/dialog changes;
 * transport sessions persist acknowledged chunks across an explicit re-selection. */
export class StorageUploadQueue {
  constructor(private readonly scope = "") {}
  private snapshot: QueuedUpload[] = [];
  private listeners = new Set<() => void>();
  private records = new Map<string, UploadRecord>();
  private active = new Set<string>();
  private disposed = false;
  readonly subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  readonly getSnapshot = () => this.snapshot;
  private emit() {
    this.snapshot = [...this.snapshot];
    for (const listener of this.listeners) listener();
  }
  private update(id: string, patch: Partial<QueuedUpload>) {
    this.snapshot = this.snapshot.map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    );
    this.emit();
  }
  enqueue(
    files: Array<{ file: File; path: string }>,
    nodeId: string,
  ): string[] {
    if (this.disposed) return [];
    if (files.length + this.snapshot.length > 1000)
      throw new Error("storageUpload.queueFull");
    const destinations = new Set<string>();
    for (const { path } of files) {
      if (
        destinations.has(path) ||
        this.snapshot.some(
          (item) =>
            item.nodeId === nodeId &&
            item.path === path &&
            !["success", "cancelled"].includes(item.state),
        )
      )
        throw new Error("storageUpload.duplicate");
      destinations.add(path);
    }
    const ids: string[] = [];
    for (const { file, path } of files) {
      const id = crypto.randomUUID();
      this.records.set(id, { file });
      this.snapshot = [
        ...this.snapshot,
        {
          id,
          name: path,
          path,
          nodeId,
          size: file.size,
          state: "pending",
          percent: 0,
        },
      ];
      ids.push(id);
    }
    this.emit();
    this.pump();
    return ids;
  }
  pause(id: string) {
    const item = this.snapshot.find((entry) => entry.id === id);
    if (!item || !["pending", "uploading"].includes(item.state)) return;
    this.update(id, { state: "paused" });
    this.records.get(id)?.controller?.abort();
  }
  resume(id: string) {
    const item = this.snapshot.find((entry) => entry.id === id);
    if (
      !item ||
      this.disposed ||
      this.active.has(id) ||
      !["paused", "error", "cancel-error"].includes(item.state)
    )
      return;
    if (item.state === "cancel-error") {
      void this.cleanup(item, this.records.get(id)!);
      return;
    }
    this.update(id, { state: "pending", error: undefined });
    this.pump();
  }
  cancel(id: string) {
    const item = this.snapshot.find((entry) => entry.id === id);
    const record = this.records.get(id);
    if (
      !item ||
      !record ||
      ["finalizing", "success", "cancelled", "unknown"].includes(item.state)
    )
      return;
    record.cancelRequested = true;
    this.update(id, { state: "cancelled" });
    record.controller?.abort();
    if (!this.active.has(id)) void this.cleanup(item, record);
  }
  private async cleanup(item: QueuedUpload, record: UploadRecord) {
    this.active.add(item.id);
    try {
      if (record.file.size >= STORAGE_CHUNKED_THRESHOLD_BYTES)
        await cancelStorageFileUpload(
          record.file,
          item.nodeId,
          item.path,
          this.scope,
        );
      this.records.delete(item.id);
      this.update(item.id, { state: "cancelled", error: undefined });
    } catch (error) {
      this.update(item.id, {
        state: "cancel-error",
        error: String(error instanceof Error ? error.message : error),
      });
    } finally {
      this.active.delete(item.id);
      this.emit();
      this.pump();
    }
  }
  clearFinished() {
    const finished = this.snapshot.filter(
      (item) =>
        ["success", "cancelled", "unknown"].includes(item.state) &&
        !this.active.has(item.id),
    );
    for (const item of finished) this.records.delete(item.id);
    const ids = new Set(finished.map((item) => item.id));
    this.snapshot = this.snapshot.filter((item) => !ids.has(item.id));
    this.emit();
  }
  isSettling(id: string) {
    return this.active.has(id);
  }
  dispose() {
    this.disposed = true;
    for (const record of this.records.values()) record.controller?.abort();
    this.listeners.clear();
  }
  private pump() {
    if (this.disposed) return;
    for (const item of this.snapshot) {
      if (this.active.size >= 2) break;
      if (item.state !== "pending" || this.active.has(item.id)) continue;
      // Two writes to the same destination must never race, including retries.
      if (
        this.snapshot.some(
          (other) =>
            this.active.has(other.id) &&
            other.nodeId === item.nodeId &&
            other.path === item.path,
        )
      )
        continue;
      this.active.add(item.id);
      void this.run(item);
    }
  }
  private async run(item: QueuedUpload) {
    const record = this.records.get(item.id)!;
    const controller = new AbortController();
    record.controller = controller;
    this.update(item.id, { state: "uploading" });
    try {
      let result: UploadResult;
      if (record.file.size >= STORAGE_CHUNKED_THRESHOLD_BYTES) {
        result = await uploadStorageFileChunked({
          file: record.file,
          storageNodeId: item.nodeId,
          relativePath: item.path,
          signal: controller.signal,
          scope: this.scope,
          onProgress: (progress) =>
            this.update(item.id, { percent: progress.percent }),
          onFinalizing: () => this.update(item.id, { state: "finalizing" }),
        });
      } else {
        // Single-shot writes cannot be paused once submitted: aborting their
        // response would not undo a server commit. Let them settle truthfully.
        this.update(item.id, { state: "finalizing" });
        const body = new FormData();
        body.set("storageNodeId", item.nodeId);
        body.set("relativePath", item.path);
        body.set("file", record.file);
        result = await csrfFetch<UploadResult>("/api/storage/local", {
          method: "POST",
          body,
        });
      }
      this.update(item.id, {
        state: "success",
        percent: 100,
        path: result.relativePath ?? item.path,
        size: result.size ?? item.size,
      });
      this.records.delete(item.id);
    } catch (error) {
      if (!controller.signal.aborted) {
        const uncertain =
          record.file.size < STORAGE_CHUNKED_THRESHOLD_BYTES &&
          (!(error instanceof ApiError) || error.status >= 500);
        this.update(item.id, {
          state: uncertain ? "unknown" : "error",
          error: uncertain
            ? "storageUpload.unknown"
            : error instanceof Error
              ? error.message
              : String(error),
        });
      }
    } finally {
      if (record.cancelRequested) await this.cleanup(item, record);
      this.active.delete(item.id);
      this.emit();
      this.pump();
    }
  }
}
