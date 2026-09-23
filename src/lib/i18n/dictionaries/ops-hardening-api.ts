/**
 * i18n dictionary: server-side hardening copy for the background-task /
 * monitoring / AI domain (durable-job maintenance, scheduled-task worker,
 * alert-rule API guards).
 *
 * Domain-owned by the ops-hardening area — only this domain's changes add
 * keys here, which keeps parallel edits off the shared service-translations.ts
 * barrel.
 */
export const zh: Record<string, string> = {
	"backend.scheduled-task.skippedMissingTargetOrCreator":
		"已跳过：任务缺少目标服务器或创建者",
	"backend.scheduled-task.skippedRequesterNotAuthorized":
		"已跳过：创建者已无执行权限（{reason}）",
	"backend.scheduled-task.manualRetryMissingTargetOrCreator":
		"手动重试失败：任务缺少目标服务器或创建者",
};

export const en: Record<string, string> = {
	"backend.scheduled-task.skippedMissingTargetOrCreator":
		"Skipped: the task has no target server or no creator",
	"backend.scheduled-task.skippedRequesterNotAuthorized":
		"Skipped: the creator is no longer authorized to execute commands ({reason})",
	"backend.scheduled-task.manualRetryMissingTargetOrCreator":
		"Manual retry failed: the task has no target server or no creator",
};
