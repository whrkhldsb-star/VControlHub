"use client";

export function FloatingToast({ toast }: { toast: { message: string; tone: "status" | "alert" } | null }) {
	if (!toast) return null;
	return (
		<>
			<div role={toast.tone} className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-3 z-[var(--z-toast)] max-w-[calc(100vw-1.5rem)] break-words animate-fade-in rounded-lg border border-[var(--border)] bg-[var(--modal-bg)] px-4 py-2.5 text-sm text-[var(--text-primary)] shadow-lg lg:bottom-6 lg:right-6">
				{toast.message}
			</div>
			<style>{`
				@keyframes fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
				.animate-fade-in { animation: fade-in 0.2s ease-out; }
			`}</style>
		</>
	);
}
