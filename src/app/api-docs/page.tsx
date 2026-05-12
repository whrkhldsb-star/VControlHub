"use client";

import { useEffect, useRef } from "react";

/**
 * API Documentation page — embedded Scalar API reference.
 * Loads the OpenAPI spec from /api/docs/openapi.json via data-spec-url attribute.
 */
export default function ApiDocsPage() {
	const containerRef = useRef<HTMLDivElement>(null);
	const linkRef = useRef<HTMLLinkElement | null>(null);
	const scriptRef = useRef<HTMLScriptElement | null>(null);

	useEffect(() => {
		// Load Scalar CSS
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest/dist/style.css";
		document.head.appendChild(link);
		linkRef.current = link;

		// Create the scalar container with data-spec-url attribute
		// Scalar auto-initializes when it finds this element in the DOM
		const el = document.createElement("div");
		el.id = "scalar-api-reference";
		el.setAttribute("data-spec-url", "/api/docs/openapi.json");
		containerRef.current?.appendChild(el);

		// Load Scalar JS — it auto-detects data-spec-url on mount
		const script = document.createElement("script");
		script.src = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest";
		scriptRef.current = script;
		document.head.appendChild(script);

		return () => {
			// Safe cleanup — only remove elements we created
			if (linkRef.current && linkRef.current.parentNode) {
				linkRef.current.parentNode.removeChild(linkRef.current);
			}
			if (scriptRef.current && scriptRef.current.parentNode) {
				scriptRef.current.parentNode.removeChild(scriptRef.current);
			}
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

				{/* Scalar will mount here */}
				<div ref={containerRef} className="min-h-[600px]" />

				<noscript>
					<p className="text-sm text-slate-400">需要启用 JavaScript 查看 API 文档。</p>
				</noscript>
			</div>
		</div>
	);
}
