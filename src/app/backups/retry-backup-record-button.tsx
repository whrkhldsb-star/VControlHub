"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ActionButton } from "@/components/action-button";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

type Props = {
	backupId: string;
	status: string;
};

export function RetryBackupRecordButton({ backupId, status }: Props) {
	const router = useRouter();
	const { t } = useI18n();
	const [pending, setPending] = useState(false);
	const [taskId, setTaskId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const disabled = pending || status !== "FAILED";

	const handleRetry = async () => {
		if (disabled) return;
		setPending(true);
		setTaskId(null);
		setError(null);
		try {
			const result = await csrfFetch(`/api/backups/${backupId}/retry`, { method: "POST" });
			setTaskId(result?.taskId ?? null);
			router.refresh();
		} catch (retryError) {
			setError(
				retryError instanceof Error ? retryError.message : t("backupsPage.retry.errorFallback"),
			);
		} finally {
			setPending(false);
		}
	};

	return (
		<div className="grid gap-1">
			<ActionButton
				type="button"
				variant="outline"
				disabled={disabled}
				onClick={handleRetry}
				className="w-fit text-xs"
			>
				{pending ? t("backupsPage.retry.pending") : t("backupsPage.retry.submit")}
			</ActionButton>
			{taskId && (
				<p role="status" className="text-xs text-[var(--success)]">
					{t("backupsPage.retry.successPrefix")}{" "}
					<Link href="/operation-tasks" className="underline">
						{t("backupsPage.retry.taskCenter")}
					</Link>{" "}
					{t("backupsPage.retry.successSuffix").replace("{taskId}", taskId)}
				</p>
			)}
			{error && (
				<p role="alert" className="text-xs text-[var(--danger)]">
					{error}
				</p>
			)}
		</div>
	);
}
