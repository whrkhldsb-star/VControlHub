/**
 * Shared resolution of a managed local storage path (base + relative).
 *
 * Three routes (media stream, media thumbnail, local storage upload) each
 * carried a private copy of this normalize→resolve sequence — and the copies
 * had drifted: one resolved the raw relative path before normalizing it, and
 * one returned only the absolute path. Normalizing FIRST is the safe order
 * (the resolver then always sees a cleaned path), and both values are needed
 * by callers that persist the normalized form.
 */
import { ValidationError } from "@/lib/errors";
import {
	normalizeStorageRelativePath,
	resolveStoragePathWithinBase,
} from "./path-utils";

export type ManagedLocalPath = {
	normalizedRelativePath: string;
	absolutePath: string;
};

/**
 * Normalize then resolve. Throws ValidationError on invalid input (both the
 * normalizer's and the resolver's failures map to client errors) — callers
 * sit behind the API guard which maps AppError subclasses to 4xx responses.
 */
export function resolveManagedLocalPath(
	basePath: string,
	relativePath: string,
): ManagedLocalPath {
	const normalized = normalizeStorageRelativePath(relativePath);
	if (!normalized.ok) throw new ValidationError(normalized.reason);
	const resolved = resolveStoragePathWithinBase(basePath, normalized.path);
	if (!resolved.ok) throw new ValidationError(resolved.reason);
	return {
		normalizedRelativePath: normalized.path,
		absolutePath: resolved.path,
	};
}
