"use client";

import { useEffect, useRef } from "react";

/**
 * API Documentation page — embedded Swagger UI via scalar.
 * Loads the OpenAPI spec from /api/docs/openapi.json
 */
export default function ApiDocsPage() {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		// Load Scalar API reference (modern Swagger UI alternative)
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest/dist/style.css";
		document.head.appendChild(link);

		const script = document.createElement("script");
		script.src = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest";
		script.onload = () => {
			if ((window as unknown as Record<string, unknown>).Scalar) {
				const el = document.createElement("div");
				el.id = "scalar-api-reference";
				containerRef.current?.appendChild(el);

				const initScript = document.createElement("script");
				initScript.textContent = `
					document.getElementById('scalar-api-reference')?.dispatchEvent(
						new CustomEvent('scalar:load-spec', { detail: { spec: ${JSON.stringify(null)} } })
					);
				`;
				// Use data-url attribute approach instead
				el.setAttribute("data-url", "/api/docs/openapi.json");
				el.setAttribute("data-spec-url", "/api/docs/openapi.json");
			}
		};
		document.head.appendChild(script);

		return () => {
			document.head.removeChild(link);
			document.head.removeChild(script);
		};
	}, []);

	return (
		<div className="min-h-screen bg-slate-950 text-white p-6">
			<div className="max-w-7xl mx-auto">
				<h1 className="text-xl font-semibold text-white mb-2">API 文档</h1>
				<p className="text-sm text-slate-400 mb-6">
					VPS管控平台完整的RESTful API参考文档。
					也可直接获取{" "}
					<a href="/api/docs/openapi.json" className="text-cyan-400 hover:text-cyan-300 underline" target="_blank">
						OpenAPI JSON
					</a>{" "}
					格式规范。
				</p>

				{/* Fallback: simple HTML API list if Scalar fails to load */}
				<div ref={containerRef} className="min-h-[600px]" />

				<noscript>
					<p className="text-sm text-slate-400">需要启用 JavaScript 查看 API 文档。</p>
				</noscript>
			</div>
		</div>
	);
}
