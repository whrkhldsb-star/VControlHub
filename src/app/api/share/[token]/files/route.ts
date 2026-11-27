import { GET as downloadShare, HEAD as inspectShare } from "@/app/api/share/[token]/route";
import { prisma } from "@/lib/db";
import { rateLimitResponse, withRateLimit } from "@/lib/http/rate-limit-presets";
import { hashShareToken } from "@/lib/share-link/service";

type Context = { params: Promise<{ token: string }> };

// guardMode: public
// Public links identify a child relative to the shared folder. Its root stays server-side and the
// existing download handler enforces the ticket, directory boundary, sandbox CSP, and quota.
async function serveChild(request: Request, { params }: Context, head: boolean) {
	const { token } = await params;
	const limit = await withRateLimit(request, { bucketKey: "share-child", windowMs: 60_000, maxRequests: 120 });
	if (!limit.allowed) return rateLimitResponse(limit.retryAfterMs);
	const share = await prisma.shareLink.findUnique({
		where: { tokenHash: hashShareToken(token) },
		select: { entryType: true, path: true },
	});
	if (share?.entryType !== "DIRECTORY") return new Response(null, { status: 404 });
	const url = new URL(request.url);
	const child = url.searchParams.get("file");
	if (!child || child.split(/[\\/]/).some((part) => !part || part === "." || part === "..")) return new Response(null, { status: 404 });
	const inline = url.searchParams.get("inline") === "1";
	const rootPath = share.path.replace(/\/+$/, "");
	url.search = "";
	url.searchParams.set("path", `${rootPath}/${child}`);
	if (inline) url.searchParams.set("inline", "1");
	const forwarded = new Request(url, { method: request.method, headers: request.headers, signal: request.signal });
	return (head ? inspectShare : downloadShare)(forwarded, { params: Promise.resolve({ token }) });
}

export function GET(request: Request, context: Context) {
	return serveChild(request, context, false);
}

export function HEAD(request: Request, context: Context) {
	return serveChild(request, context, true);
}
