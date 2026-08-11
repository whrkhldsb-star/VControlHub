"use client";

import { AlertTriangle } from "@/components/icons";

export function TextPreviewLoading({ label }: { label: string }) {
	return (
		<div className="flex items-center justify-center py-16 text-[var(--text-secondary)]">
			<span className="animate-pulse text-sm">{label}</span>
		</div>
	);
}

export function TextPreviewError({ message }: { message: string }) {
	return (
		<div className="flex flex-col items-center gap-3 py-16 text-[var(--danger)]">
			<AlertTriangle size={32} aria-hidden="true" />
			<p className="text-sm">{message}</p>
		</div>
	);
}
