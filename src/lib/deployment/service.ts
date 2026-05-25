import { prisma } from "@/lib/db";
import { createCommandRequest } from "@/lib/command/service";
import { renderCommand } from "@/lib/command-template/service";

function normalizeDeploymentInput(input: { templateId: string; serverIds: string[]; variables: Record<string, string>; requesterId: string; reason?: string }) {
  const templateId = input.templateId.trim();
  const requesterId = input.requesterId.trim();
  const serverIds = input.serverIds.map((id) => id.trim()).filter(Boolean);
  const reason = input.reason?.trim();
  if (!templateId) throw new Error("部署模板必填");
  if (!requesterId) throw new Error("请求人不能为空");
  if (serverIds.length < 1) throw new Error("至少选择 1 台目标 VPS");
  if (reason && reason.length > 500) throw new Error("原因最多 500 个字符");
  return { ...input, templateId, requesterId, serverIds, reason };
}

function assertTemplateVariables(command: string, variables: Record<string, string>) {
  const required = Array.from(command.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)).map((match) => match[1]);
  const missing = required.filter((name) => !variables[name]?.trim());
  if (missing.length > 0) throw new Error(`部署模板变量未填写完整：${missing.join(", ")}`);
}

export async function listDeploymentTemplates() {
  return prisma.commandTemplate.findMany({ orderBy: { createdAt: "desc" } });
}

export async function createDeploymentRunFromTemplate(input: { templateId: string; serverIds: string[]; variables: Record<string, string>; requesterId: string; reason?: string }) {
  const normalized = normalizeDeploymentInput(input);
  const template = await prisma.commandTemplate.findUnique({ where: { id: normalized.templateId } });
  if (!template) throw new Error("部署模板不存在");
  assertTemplateVariables(template.command, normalized.variables);
  const renderedCommand = renderCommand(template.command, normalized.variables);

  const run = await prisma.deploymentRun.create({
    data: { templateId: template.id, variables: normalized.variables, renderedCommand, serverIds: normalized.serverIds, createdBy: normalized.requesterId, status: "PENDING" },
  });

  try {
    const command = await createCommandRequest({
      title: `部署：${template.name}`,
      command: renderedCommand,
      reason: normalized.reason || "应用部署模板触发",
      submissionMode: "assistant",
      requesterId: normalized.requesterId,
      serverIds: normalized.serverIds,
    });
    return prisma.deploymentRun.update({ where: { id: run.id }, data: { commandRequestId: command.id, status: command.status === "PENDING_APPROVAL" ? "PENDING" : "RUNNING" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "命令审批链路创建失败";
    await prisma.deploymentRun.update({ where: { id: run.id }, data: { status: "FAILED", errorMessage: message } });
    throw error;
  }
}

type DeploymentRunWithCommand = {
  id: string;
  status: string;
  errorMessage?: string | null;
  completedAt?: Date | null;
  commandRequest?: { status: string } | null;
};

const DEPLOYMENT_RUN_INCLUDE = {
  template: true,
  creator: { select: { username: true, displayName: true } },
  commandRequest: { select: { status: true } },
} as const;

const TERMINAL_DEPLOYMENT_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED", "REJECTED"]);

function resolveDeploymentRunStatus(run: DeploymentRunWithCommand) {
  const commandStatus = run.commandRequest?.status;
  if (!commandStatus) return { status: run.status, errorMessage: run.errorMessage ?? null };

  if (commandStatus === "REJECTED") {
    return { status: "REJECTED", errorMessage: run.errorMessage ?? "关联命令请求已被拒绝，部署不会执行。" };
  }
  if (commandStatus === "FAILED" || commandStatus === "CANCELLED") {
    return { status: commandStatus, errorMessage: run.errorMessage ?? `关联命令请求已${commandStatus === "FAILED" ? "失败" : "取消"}。` };
  }
  if (["RUNNING", "COMPLETED", "APPROVED"].includes(commandStatus)) {
    return { status: commandStatus === "APPROVED" ? "RUNNING" : commandStatus, errorMessage: run.errorMessage ?? null };
  }
  return { status: run.status, errorMessage: run.errorMessage ?? null };
}

async function persistResolvedDeploymentRunStatus<T extends DeploymentRunWithCommand>(run: T) {
  const resolved = resolveDeploymentRunStatus(run);
  const shouldPersist =
    run.commandRequest?.status &&
    TERMINAL_DEPLOYMENT_STATUSES.has(resolved.status) &&
    (run.status !== resolved.status || (resolved.errorMessage && run.errorMessage !== resolved.errorMessage) || !run.completedAt);

  if (!shouldPersist) return { ...run, ...resolved };

  const updated = await prisma.deploymentRun.update({
    where: { id: run.id },
    data: {
      status: resolved.status,
      errorMessage: resolved.errorMessage,
      completedAt: run.completedAt ?? new Date(),
    },
    include: DEPLOYMENT_RUN_INCLUDE,
  });
  return { ...updated, ...resolveDeploymentRunStatus(updated) };
}

export async function listDeploymentRuns() {
  const runs = await prisma.deploymentRun.findMany({
    orderBy: { createdAt: "desc" },
    include: DEPLOYMENT_RUN_INCLUDE,
  });
  return Promise.all(runs.map((run) => persistResolvedDeploymentRunStatus(run)));
}
