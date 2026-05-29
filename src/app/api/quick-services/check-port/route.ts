import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { checkPort, allocatePort, getUsedPorts } from "@/lib/quick-service/service";

export const dynamic = "force-dynamic";

/** GET /api/quick-services/check-port?port=XXX — real-time port availability check */
export async function GET(request: Request) {
	return withApiRoute(request, { permission: "user:manage", errorStatus: 500, errorMessage: "服务器错误" }, async () => {
		const { searchParams } = new URL(request.url);
		const portStr = searchParams.get("port");
		const action = searchParams.get("action");

		// action=allocate: suggest a free port
		if (action === "allocate") {
			const preferredStr = searchParams.get("preferred");
			const preferred = preferredStr ? Number(preferredStr) : undefined;
			try {
				const port = allocatePort(preferred);
				return NextResponse.json({ port, available: true });
			} catch (err) {
				const msg = err instanceof Error ? err.message : "分配失败";
				return NextResponse.json({ error: msg }, { status: 503 });
			}
		}

		// action=used-ports: list all currently used ports
		if (action === "used-ports") {
			return NextResponse.json({ usedPorts: getUsedPorts() });
		}

		// Default: check a specific port
		if (!portStr) {
			return NextResponse.json({ error: "请提供 port 参数" }, { status: 400 });
		}
		const port = Number(portStr);
		if (isNaN(port) || port < 1 || port > 65535) {
			return NextResponse.json({ error: "端口号无效" }, { status: 400 });
		}

		const result = checkPort(port);
		return NextResponse.json({ port, ...result });
	});
}
