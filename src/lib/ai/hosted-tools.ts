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
  | "deploy_docker"
  | "list_backups"
  | "run_playbook"
  | "query_traffic"
  | "manage_cron"
  | "list_files"
  | "search_files"
  | "read_file"
  | "get_docker_logs";

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
    description: "List VPS targets that the current user can bind/operate. When the user says 'bind VPS' or 'operate on a VPS' but does not provide a serverId, call this tool first to get the id, name, and IP. Does not return passwords, keys, or connection credentials; this tool does not require serverId/serverQuery.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    riskLevel: "low",
    autoApproved: true,
    actionType: "list_servers",
    actionName: "List bindable VPS",
  },
  // === 安全操作（自动批准） ===
  {
    name: "get_server_status",
    description: "Get the server's running status, including CPU, memory, disk usage, and uptime. You may pass serverId; if the user only provided a VPS name/IP/keyword, pass serverQuery to let the backend resolve and bind.",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "Server ID" },
        serverQuery: { type: "string", description: "Optional: server name/IP/notes keyword, used to bind a VPS from natural language" },
      },
      required: [],
    },
    riskLevel: "low",
    autoApproved: true,
    actionType: "get_status",
    actionName: "View server status",
  },
  {
    name: "read_server_logs",
    description: "Read log file contents on the server, supports tail line count and keyword filtering. You may pass serverId; if the user only provided a VPS name/IP/keyword, pass serverQuery to let the backend resolve and bind.",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "Server ID" },
        serverQuery: { type: "string", description: "Optional: server name/IP/notes keyword, used to bind a VPS from natural language" },
        logPath: { type: "string", description: "Log file path, e.g. /var/log/syslog" },
        tail: { type: "number", description: "Read the last N lines, default 50" },
        filter: { type: "string", description: "Keyword filter" },
      },
      required: ["logPath"],
    },
    riskLevel: "low",
    autoApproved: true,
    actionType: "read_logs",
    actionName: "Read server logs",
  },
  {
    name: "list_docker_containers",
    description: "List Docker containers on the server and their status. You may pass serverId; if the user only provided a VPS name/IP/keyword, pass serverQuery to let the backend resolve and bind.",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "Server ID" },
        serverQuery: { type: "string", description: "Optional: server name/IP/notes keyword, used to bind a VPS from natural language" },
      },
      required: [],
    },
    riskLevel: "low",
    autoApproved: true,
    actionType: "list_docker_containers",
    actionName: "List Docker containers",
  },
  {
    name: "check_service_status",
    description: "Check the running status of systemd services on the server. You may pass serverId; if the user only provided a VPS name/IP/keyword, pass serverQuery to let the backend resolve and bind.",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "Server ID" },
        serverQuery: { type: "string", description: "Optional: server name/IP/notes keyword, used to bind a VPS from natural language" },
        serviceName: { type: "string", description: "Service name, e.g. nginx, postgresql" },
      },
      required: ["serviceName"],
    },
    riskLevel: "low",
    autoApproved: true,
    actionType: "check_service_status",
    actionName: "Check service status",
  },

  // === 中等风险操作（需审批） ===
  {
    name: "execute_command",
    description: "Execute a specified shell command on the server. Dangerous operation; requires user confirmation and creating a command request to enter the approval workflow. You may pass serverId; if the user only provided a VPS name/IP/keyword, pass serverQuery to let the backend resolve and bind.",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "Server ID" },
        serverQuery: { type: "string", description: "Optional: server name/IP/notes keyword, used to bind a VPS from natural language" },
        command: { type: "string", description: "Command to execute" },
        reason: { type: "string", description: "Execution reason description" },
      },
      required: ["command", "reason"],
    },
    riskLevel: "medium",
    autoApproved: false,
    actionType: "execute_command",
    actionName: "Execute command",
  },
  {
    name: "restart_service",
    description: "Restart a systemd service on the server. Requires user confirmation and creating a command request to enter the approval workflow. You may pass serverId; if the user only provided a VPS name/IP/keyword, pass serverQuery to let the backend resolve and bind.",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "Server ID" },
        serverQuery: { type: "string", description: "Optional: server name/IP/notes keyword, used to bind a VPS from natural language" },
        serviceName: { type: "string", description: "Service name" },
        reason: { type: "string", description: "Restart reason" },
      },
      required: ["serviceName", "reason"],
    },
    riskLevel: "high",
    autoApproved: false,
    actionType: "restart_service",
    actionName: "Restart service",
  },
  {
    name: "modify_config",
    description: "Modify a configuration file on the server. Requires user confirmation and creating a command request to enter the approval workflow; specific changes can be reviewed during approval. You may pass serverId; if the user only provided a VPS name/IP/keyword, pass serverQuery to let the backend resolve and bind.",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "Server ID" },
        serverQuery: { type: "string", description: "Optional: server name/IP/notes keyword, used to bind a VPS from natural language" },
        configPath: { type: "string", description: "Config file path" },
        content: { type: "string", description: "New configuration content" },
        reason: { type: "string", description: "Modification reason" },
      },
      required: ["configPath", "content", "reason"],
    },
    riskLevel: "high",
    autoApproved: false,
    actionType: "modify_config",
    actionName: "Modify config file",
  },
  {
    name: "deploy_docker",
    description: "Deploy a Docker container on the server. Requires user confirmation and creating a command request to enter the approval workflow. You may pass serverId; if the user only provided a VPS name/IP/keyword, pass serverQuery to let the backend resolve and bind.",
    parameters: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "Server ID" },
        serverQuery: { type: "string", description: "Optional: server name/IP/notes keyword, used to bind a VPS from natural language" },
        imageName: { type: "string", description: "Docker image name" },
        containerName: { type: "string", description: "Container name" },
        ports: { type: "string", description: "Port mapping, e.g. 80:8080" },
        envVars: { type: "string", description: "Environment variables, JSON format" },
        reason: { type: "string", description: "Deployment reason" },
      },
      required: ["imageName", "containerName", "reason"],
    },
    riskLevel: "critical",
    autoApproved: false,
    actionType: "deploy_docker",
    actionName: "Deploy Docker container",
  },
  // === 跨模块安全查询（自动批准） ===
  {
    name: "list_backups",
    description: "List backup records in the system, including the type, status, and creation time of database backups, file backups, and full backups.",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", description: "Optional: filter by type DATABASE/FILES/FULL" },
        status: { type: "string", description: "Optional: filter by status COMPLETED/FAILED/PENDING" },
      },
      required: [],
    },
    riskLevel: "low",
    autoApproved: true,
    actionType: "list_backups",
    actionName: "List backup records",
  },
  {
    name: "run_playbook",
    description: "Execute a saved ops Playbook (predefined command sequence). Requires user confirmation of the playbook ID to execute. You may pass playbookId or playbookName to look it up in the backend.",
    parameters: {
      type: "object",
      properties: {
        playbookId: { type: "string", description: "Playbook ID" },
        playbookName: { type: "string", description: "Optional: look up Playbook by name" },
        serverId: { type: "string", description: "Optional: specify the target server ID for execution" },
      },
      required: [],
    },
    riskLevel: "medium",
    autoApproved: false,
    actionType: "run_playbook",
    actionName: "Execute Playbook",
  },
  {
    name: "query_traffic",
    description: "Query the system traffic overview, including total inbound/outbound traffic and recent trend data. Not specific to any server; returns a global summary.",
    parameters: {
      type: "object",
      properties: {
        period: { type: "string", description: "Query period: today/7d/30d, default today" },
      },
      required: [],
    },
    riskLevel: "low",
    autoApproved: true,
    actionType: "query_traffic",
    actionName: "Query traffic data",
  },
  {
    name: "manage_cron",
    description: "Manage scheduled tasks. Supports list (list all scheduled tasks), pause, and resume operations. Creating/deleting scheduled tasks requires the command approval workflow.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "Action type: list/pause/resume", enum: ["list", "pause", "resume"] },
        taskId: { type: "string", description: "Scheduled task ID (required for pause/resume)" },
      },
      required: ["action"],
    },
    riskLevel: "low",
    autoApproved: true,
    actionType: "manage_cron",
    actionName: "Manage scheduled tasks",
  },
  {
    name: "list_files",
    description: "List files and directories on a VPS. The path must be absolute and cannot contain traversal segments.",
    parameters: { type: "object", properties: { serverId: { type: "string" }, serverQuery: { type: "string" }, path: { type: "string", description: "Absolute directory path" } }, required: ["path"] },
    riskLevel: "low", autoApproved: true, actionType: "list_files", actionName: "List files",
  },
  {
    name: "search_file_contents",
    description: "Search text content under a VPS directory using a literal query. Results are capped for safety.",
    parameters: { type: "object", properties: { serverId: { type: "string" }, serverQuery: { type: "string" }, path: { type: "string" }, query: { type: "string" }, filePattern: { type: "string" } }, required: ["path", "query"] },
    riskLevel: "low", autoApproved: true, actionType: "search_files", actionName: "Search file contents",
  },
  {
    name: "read_file",
    description: "Read the tail of a text file on a VPS. Output is capped at 1000 lines.",
    parameters: { type: "object", properties: { serverId: { type: "string" }, serverQuery: { type: "string" }, filePath: { type: "string" }, tail: { type: "number" } }, required: ["filePath"] },
    riskLevel: "low", autoApproved: true, actionType: "read_file", actionName: "Read file",
  },
  {
    name: "get_docker_logs",
    description: "Read recent Docker container logs from a VPS.",
    parameters: { type: "object", properties: { serverId: { type: "string" }, serverQuery: { type: "string" }, containerId: { type: "string" }, tail: { type: "number" } }, required: ["containerId"] },
    riskLevel: "low", autoApproved: true, actionType: "get_docker_logs", actionName: "Read Docker logs",
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
