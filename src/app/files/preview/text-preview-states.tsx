"use client";

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
			<span className="text-3xl">⚠️</span>
			<p className="text-sm">{message}</p>
		</div>
	);
}
