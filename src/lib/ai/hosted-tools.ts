/**
 * AI 托管工具定义（Function Calling）
 * 
 * 安全操作（autoApproved=true）直接执行
 * 危险操作需要审批
 */

// ── 工具类型定义 ──────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type HostedActionType =
  | "list_servers"
  | "get_status"
  | "read_logs"
  | "list_docker_containers"
  | "check_service_status"
  | "execute_command"
  | "restart_service"
  | "modify_config"
  | "deploy_docker";

export interface HostedTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  riskLevel: RiskLevel;
  autoApproved: boolean; // true = 安全操作，直接执行
  actionType: HostedActionType; // 对应 AiHostedAction.actionType
  actionName: string; // 人类可读名称
}

// ── 工具列表 ──────────────────────────────────────────────

export const HOSTED_TOOLS: HostedTool[] = [
  {
    name: "list_servers",
    description: "列出当前用户可绑定/操作的 VPS 目标。用户说“绑定 VPS”“在某台 VPS 上操作”但没有提供 serverId 时，先调用这个工具获取 id、名称和 IP。不会返回密码、密钥或连接凭据；本工具不需要 serverId/serverQuery。",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    riskLevel: "low",
    autoApproved: true,
    actionType: "list_servers",
    actionName: "列出可绑定VPS",
  },
  // === 安全操作（自动批准） ===
  {
    name: "get_server_status",
    description: "获取服务器的运行状态，包括CPU、内存、磁盘使用率和运行时间。可传 serverId；如果用户只说了 VPS 名称/IP/关键词，传 serverQuery 让后端解析绑定。",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "服务器ID" },
        serverQuery: { type: "string", description: "可选：服务器名称/IP/备注关键词，用于从自然语言绑定 VPS" },
      },
      required: [],
    },
    riskLevel: "low",
    autoApproved: true,
    actionType: "get_status",
    actionName: "查看服务器状态",
  },
  {
    name: "read_server_logs",
    description: "读取服务器上的日志文件内容，支持 tail 行数和关键词过滤。可传 serverId；如果用户只说了 VPS 名称/IP/关键词，传 serverQuery 让后端解析绑定。",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "服务器ID" },
        serverQuery: { type: "string", description: "可选：服务器名称/IP/备注关键词，用于从自然语言绑定 VPS" },
        logPath: { type: "string", description: "日志文件路径，如 /var/log/syslog" },
        tail: { type: "number", description: "读取最后N行，默认50" },
        filter: { type: "string", description: "关键词过滤" },
      },
      required: ["logPath"],
    },
    riskLevel: "low",
    autoApproved: true,
    actionType: "read_logs",
    actionName: "读取服务器日志",
  },
  {
    name: "list_docker_containers",
    description: "列出服务器上的 Docker 容器及其状态。可传 serverId；如果用户只说了 VPS 名称/IP/关键词，传 serverQuery 让后端解析绑定。",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "服务器ID" },
        serverQuery: { type: "string", description: "可选：服务器名称/IP/备注关键词，用于从自然语言绑定 VPS" },
      },
      required: [],
    },
    riskLevel: "low",
    autoApproved: true,
    actionType: "list_docker_containers",
    actionName: "列出Docker容器",
  },
  {
    name: "check_service_status",
    description: "检查服务器上 systemd 服务的运行状态。可传 serverId；如果用户只说了 VPS 名称/IP/关键词，传 serverQuery 让后端解析绑定。",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "服务器ID" },
        serverQuery: { type: "string", description: "可选：服务器名称/IP/备注关键词，用于从自然语言绑定 VPS" },
        serviceName: { type: "string", description: "服务名称，如 nginx, postgresql" },
      },
      required: ["serviceName"],
    },
    riskLevel: "low",
    autoApproved: true,
    actionType: "check_service_status",
    actionName: "检查服务状态",
  },

  // === 中等风险操作（需审批） ===
  {
    name: "execute_command",
    description: "在服务器上执行指定的 shell 命令。危险操作，需要用户确认并创建命令请求后进入审批链路。可传 serverId；如果用户只说了 VPS 名称/IP/关键词，传 serverQuery 让后端解析绑定。",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "服务器ID" },
        serverQuery: { type: "string", description: "可选：服务器名称/IP/备注关键词，用于从自然语言绑定 VPS" },
        command: { type: "string", description: "要执行的命令" },
        reason: { type: "string", description: "执行原因说明" },
      },
      required: ["command", "reason"],
    },
    riskLevel: "medium",
    autoApproved: false,
    actionType: "execute_command",
    actionName: "执行命令",
  },
  {
    name: "restart_service",
    description: "重启服务器上的 systemd 服务。需要用户确认并创建命令请求后进入审批链路。可传 serverId；如果用户只说了 VPS 名称/IP/关键词，传 serverQuery 让后端解析绑定。",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "服务器ID" },
        serverQuery: { type: "string", description: "可选：服务器名称/IP/备注关键词，用于从自然语言绑定 VPS" },
        serviceName: { type: "string", description: "服务名称" },
        reason: { type: "string", description: "重启原因" },
      },
      required: ["serviceName", "reason"],
    },
    riskLevel: "high",
    autoApproved: false,
    actionType: "restart_service",
    actionName: "重启服务",
  },
  {
    name: "modify_config",
    description: "修改服务器上的配置文件。需要用户确认并创建命令请求后进入审批链路，并可在审批时查看具体变更。可传 serverId；如果用户只说了 VPS 名称/IP/关键词，传 serverQuery 让后端解析绑定。",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "服务器ID" },
        serverQuery: { type: "string", description: "可选：服务器名称/IP/备注关键词，用于从自然语言绑定 VPS" },
        configPath: { type: "string", description: "配置文件路径" },
        content: { type: "string", description: "新的配置内容" },
        reason: { type: "string", description: "修改原因" },
      },
      required: ["configPath", "content", "reason"],
    },
    riskLevel: "high",
    autoApproved: false,
    actionType: "modify_config",
    actionName: "修改配置文件",
  },
  {
    name: "deploy_docker",
    description: "在服务器上部署 Docker 容器。需要用户确认并创建命令请求后进入审批链路。可传 serverId；如果用户只说了 VPS 名称/IP/关键词，传 serverQuery 让后端解析绑定。",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "服务器ID" },
        serverQuery: { type: "string", description: "可选：服务器名称/IP/备注关键词，用于从自然语言绑定 VPS" },
        imageName: { type: "string", description: "Docker 镜像名称" },
        containerName: { type: "string", description: "容器名称" },
        ports: { type: "string", description: "端口映射，如 80:8080" },
        envVars: { type: "string", description: "环境变量，JSON 格式" },
        reason: { type: "string", description: "部署原因" },
      },
      required: ["imageName", "containerName", "reason"],
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
