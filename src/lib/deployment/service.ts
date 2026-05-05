import { prisma } from "@/lib/db";
import { createCommandRequest } from "@/lib/command/service";
import { renderCommand } from "@/lib/command-template/service";

export async function createDeploymentRunFromTemplate(input: { templateId: string; serverIds: string[]; variables: Record<string, string>; requesterId: string; reason?: string }) {
  const template = await prisma.commandTemplate.findUnique({ where: { id: input.templateId } });
  if (!template) throw new Error("部署模板不存在");
  const renderedCommand = renderCommand(template.command, input.variables);
  if (/\{\{\w+\}\}/.test(renderedCommand)) throw new Error("部署模板变量未填写完整");

  const run = await prisma.deploymentRun.create({
    data: { templateId: template.id, variables: input.variables, renderedCommand, serverIds: input.serverIds, createdBy: input.requesterId, status: "PENDING" },
  });
  const command = await createCommandRequest({
    title: `部署：${template.name}`,
    command: renderedCommand,
    reason: input.reason || "应用部署模板触发",
    submissionMode: "user",
    requesterId: input.requesterId,
    serverIds: input.serverIds,
  });
  return prisma.deploymentRun.update({ where: { id: run.id }, data: { commandRequestId: command.id, status: command.status === "PENDING_APPROVAL" ? "PENDING" : "RUNNING" } });
}

export async function listDeploymentRuns() {
  return prisma.deploymentRun.findMany({ orderBy: { createdAt: "desc" }, include: { template: true, creator: { select: { username: true, displayName: true } } } });
}
