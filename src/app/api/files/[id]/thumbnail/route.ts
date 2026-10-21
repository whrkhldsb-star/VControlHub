import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * GET /api/files/[id]/thumbnail — a small JPEG of an image file, for the file
 * browser's grid and list. The full image is only fetched when it is opened.
 */
import { NextResponse } from "next/server";

import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { normalizeStorageRelativePath } from "@/lib/storage/path-utils";
import { toClientStorageError } from "@/lib/storage/remote-path";
import { respondWithStorageThumbnail } from "@/lib/storage/thumbnail-response";
import { SSH_KEY_CREDENTIAL_SELECT } from "@/lib/ssh/ssh-key-crypto";
import { getServerLocale } from "@/lib/i18n/translations";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";
import { apiError } from "@/lib/http/api-error";

export const dynamic = "force-dynamic";

/** Same node fields as the media library's stream select: the SFTP read needs them all. */
const THUMBNAIL_NODE_SELECT = {
	id: true,
	driver: true,
	basePath: true,
	serverId: true,
	hostKeySha256: true,
	host: true,
	port: true,
	username: true,
	server: {
		select: {
			id: true,
			name: true,
			host: true,
			port: true,
			username: true,
			connectionType: true,
			managementMode: true,
			operatingSystem: true,
			password: true,
			hostKeySha256: true,
			sshKey: { select: SSH_KEY_CREDENTIAL_SELECT },
		},
	},
} as const;

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	return withApiRoute(
		request,
		{
			permission: "storage:read",
			rateLimit: GENERAL_READ_LIMIT,
			errorMessage: apiCopy("apiCopy.failed.to.read.file.thumbnail.7c1f0a2e"),
		},
		async ({ session }) => {
			const locale = await getServerLocale();
			const { id } = await params;
			const entry = await prisma.fileEntry.findFirst({
				where: { id, isDeleted: false, entryType: "FILE", storageNode: teamWhere(session) },
				select: {
					id: true,
					mimeType: true,
					relativePath: true,
					updatedAt: true,
					storageNode: { select: THUMBNAIL_NODE_SELECT },
				},
			});
			if (!entry) {
				return apiError({ code: "NOT_FOUND", message: apiCopy("apiCopy.file.not.found.3521021a"), status: 404 });
			}
			if (!(entry.mimeType ?? "").toLowerCase().startsWith("image/")) {
				return apiError({
					code: "UNSUPPORTED_MEDIA_TYPE",
					message: apiCopy("apiCopy.this.file.type.does.not.support.thumbnails.4b8e2d91"),
					status: 415,
				});
			}
			const relativePath = normalizeStorageRelativePath(entry.relativePath);
			if (!relativePath.ok) {
				return NextResponse.json(
					toClientStorageError(apiCopy("apiCopy.requested.path.exceeds.storage.node.root.directory.d786fee2")),
					{ status: 400 },
				);
			}
			const access = await assertStorageAccess({
				session,
				storageNodeId: entry.storageNode.id,
				relativePath: relativePath.path,
				operation: "read",
			});
			if (!access.allowed) {
				return apiError({ code: "FORBIDDEN", message: storageAccessDeniedCopy(access.reason, locale), status: 403 });
			}
			return respondWithStorageThumbnail({
				id: entry.id,
				updatedAt: entry.updatedAt,
				relativePath: relativePath.path,
				node: entry.storageNode,
				placeholder: false,
			});
		},
	);
}
