/**
 * i18n dictionary: `apiAiChat.*` — POST /api/ai/chat (R26).
 */
export const zh: Record<string, string> = {
	"apiAiChat.rateLimited": "请求过于频繁，请稍后再试",
	"apiAiChat.errorMessage": "AI 请求失败",
	"apiAiChat.unknownTool": "未知工具：{name}",
	"apiAiChat.toolUnavailableInPlanMode": "方案模式下不能调用 {name}：这里只能查看状态和制定方案，要执行变更请把会话切到协作模式",
	"apiAiChat.missingParams": "缺少必要参数",
	"apiAiChat.conversationNotFound": "对话不存在",
	"apiAiChat.attachmentPrefix": "\n\n📎 附件内容:\n\n",
	"apiAiChat.requestFailedFallback": "AI 请求失败",
	"apiAiChat.cannotReadStream": "无法读取响应流",
	"apiAiChat.streamErrorFallback": "流式传输错误",
	"apiAiChat.emptyContent": "(无响应内容)",
	"apiAiChat.waitingForApproval": "等待审批",
	"apiAiChat.streamInterrupted": "（生成已中止）",
};

export const en: Record<string, string> = {
	"apiAiChat.rateLimited": "Too many requests, please try again later.",
	"apiAiChat.errorMessage": "AI request failed",
	"apiAiChat.unknownTool": "Unknown tool: {name}",
	"apiAiChat.toolUnavailableInPlanMode": "{name} is not available in plan-only mode: inspect and plan here, switch the conversation to assisted mode to make changes",
	"apiAiChat.missingParams": "Missing required parameters",
	"apiAiChat.conversationNotFound": "Conversation not found",
	"apiAiChat.attachmentPrefix": "\n\n📎 Attachment contents:\n\n",
	"apiAiChat.requestFailedFallback": "AI request failed",
	"apiAiChat.cannotReadStream": "Cannot read response stream",
	"apiAiChat.streamErrorFallback": "Streaming error",
	"apiAiChat.emptyContent": "(no response content)",
	"apiAiChat.waitingForApproval": "Waiting for approval",
	"apiAiChat.streamInterrupted": "(generation interrupted)",
};
