import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { getCurrentSession } from "@/lib/auth/server-session";
import { canPreviewClosedBoard } from "@/lib/public-status/access";
import { parseHistoryRange } from "@/lib/public-status/query";
import { readPublicNode } from "@/lib/public-status/read";
import { PublicNodeClient } from "./public-node-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = { robots: { index: false } };

/**
 * Public node detail. Hidden, unpublished and unknown ids, and every node of
 * a closed board, are a plain 404 (an administrator may preview with ?preview=1).
 */
export default async function PublicNodePage({
	params,
	searchParams,
}: {
	params: Promise<{ publicId: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const [{ publicId }, query, rawSession] = await Promise.all([params, searchParams, getCurrentSession()]);
	const session = rawSession?.mustChangePassword ? null : rawSession;
	const preview = query.preview === "1" && canPreviewClosedBoard(session);
	const detail = await readPublicNode(publicId, { preview });
	if (!detail) notFound();
	return (
		<PageShell navigation={Boolean(session)}>
			<PublicNodeClient
				initial={detail}
				initialRange={parseHistoryRange(typeof query.range === "string" ? query.range : null)}
				preview={preview}
				signedIn={Boolean(session)}
			/>
		</PageShell>
	);
}
