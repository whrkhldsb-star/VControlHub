"use client";

export function FloatingToast({ toast }: { toast: { message: string; tone: "status" | "alert" } | null }) {
	if (!toast) return null;
	return (
		<>
			<div role={toast.tone} className="fixed bottom-6 right-6 z-50 animate-fade-in rounded-xl border border-[var(--border)] bg-[var(--modal-bg)] px-4 py-2.5 text-sm text-[var(--text-primary)] shadow-lg">
				{toast.message}
			</div>
			<style>{`
				@keyframes fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
				.animate-fade-in { animation: fade-in 0.2s ease-out; }
			`}</style>
		</>
	);
}
