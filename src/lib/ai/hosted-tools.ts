/**
 * AI 托管工具定义（Function Calling）
 * 
 * 安全操作（autoApproved=true）直接执行
 * 危险操作需要审批
 */

// ── 工具类型定义 ──────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface HostedTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  riskLevel: RiskLevel;
  autoApproved: boolean; // true = 安全操作，直接执行
  actionType: string; // 对应 AiHostedAction.actionType
  actionName: string; // 人类可读名称
}

// ── 工具列表 ──────────────────────────────────────────────

export const HOSTED_TOOLS: HostedTool[] = [
  // === 安全操作（自动批准） ===
  {
    name: "get_server_status",
    description: "获取服务器的运行状态，包括CPU、内存、磁盘使用率和运行时间",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "服务器ID" },
      },
      required: ["serverId"],
    },
    riskLevel: "low",
    autoApproved: true,
    actionType: "get_status",
    actionName: "查看服务器状态",
  },
  {
    name: "read_server_logs",
    description: "读取服务器上的日志文件内容，支持 tail 行数和关键词过滤",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "服务器ID" },
        logPath: { type: "string", description: "日志文件路径，如 /var/log/syslog" },
        tail: { type: "number", description: "读取最后N行，默认50" },
        filter: { type: "string", description: "关键词过滤" },
      },
      required: ["serverId", "logPath"],
    },
    riskLevel: "low",
    autoApproved: true,
    actionType: "read_logs",
    actionName: "读取服务器日志",
  },
  {
    name: "list_docker_containers",
    description: "列出服务器上的 Docker 容器及其状态",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "服务器ID" },
      },
      required: ["serverId"],
    },
    riskLevel: "low",
    autoApproved: true,
    actionType: "get_status",
    actionName: "列出Docker容器",
  },
  {
    name: "check_service_status",
    description: "检查服务器上 systemd 服务的运行状态",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "服务器ID" },
        serviceName: { type: "string", description: "服务名称，如 nginx, postgresql" },
      },
      required: ["serverId", "serviceName"],
    },
    riskLevel: "low",
    autoApproved: true,
    actionType: "get_status",
    actionName: "检查服务状态",
  },

  // === 中等风险操作（需审批） ===
  {
    name: "execute_command",
    description: "在服务器上执行指定的 shell 命令。危险操作，需要审批后执行。",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "服务器ID" },
        command: { type: "string", description: "要执行的命令" },
        reason: { type: "string", description: "执行原因说明" },
      },
      required: ["serverId", "command", "reason"],
    },
    riskLevel: "medium",
    autoApproved: false,
    actionType: "execute_command",
    actionName: "执行命令",
  },
  {
    name: "restart_service",
    description: "重启服务器上的 systemd 服务。需要审批。",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "服务器ID" },
        serviceName: { type: "string", description: "服务名称" },
        reason: { type: "string", description: "重启原因" },
      },
      required: ["serverId", "serviceName", "reason"],
    },
    riskLevel: "high",
    autoApproved: false,
    actionType: "restart_service",
    actionName: "重启服务",
  },
  {
    name: "modify_config",
    description: "修改服务器上的配置文件。需要审批，并可在审批时查看具体变更。",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "服务器ID" },
        configPath: { type: "string", description: "配置文件路径" },
        content: { type: "string", description: "新的配置内容" },
        reason: { type: "string", description: "修改原因" },
      },
      required: ["serverId", "configPath", "content", "reason"],
    },
    riskLevel: "high",
    autoApproved: false,
    actionType: "modify_config",
    actionName: "修改配置文件",
  },
  {
    name: "deploy_docker",
    description: "在服务器上部署 Docker 容器。需要审批。",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "服务器ID" },
        imageName: { type: "string", description: "Docker 镜像名称" },
        containerName: { type: "string", description: "容器名称" },
        ports: { type: "string", description: "端口映射，如 80:8080" },
        envVars: { type: "string", description: "环境变量，JSON 格式" },
        reason: { type: "string", description: "部署原因" },
      },
      required: ["serverId", "imageName", "containerName", "reason"],
    },
    riskLevel: "critical",
    autoApproved: false,
    actionType: "deploy_docker",
    actionName: "部署Docker容器",
  },
];

// ── 工具查找 ──────────────────────────────────────────────

export function getToolByName(name: string): HostedTool | undefined {
  return HOSTED_TOOLS.find((t) => t.name === name);
}

// ── OpenAI Function Calling 格式 ──────────────────────────

export function getOpenAIToolsFormat(): Array<{
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return HOSTED_TOOLS.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

// ── Anthropic Tool Use 格式 ────────────────────────────────

export function getAnthropicToolsFormat(): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return HOSTED_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}
