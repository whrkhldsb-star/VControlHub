import { AlertTriangle } from "@/components/icons";
import { InlineLoading } from "@/components/ui-primitives";

export function TextPreviewLoading({ label }: { label: string }) {
	return (
		<div className="py-16">
			<InlineLoading label={label} />
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
