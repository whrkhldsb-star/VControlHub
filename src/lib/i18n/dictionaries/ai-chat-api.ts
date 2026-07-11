/**
 * i18n dictionary: `apiAiChat.*` — POST /api/ai/chat (R26).
 */
export const zh: Record<string, string> = {
	"apiAiChat.rateLimited": "请求过于频繁，请稍后再试",
	"apiAiChat.errorMessage": "AI 请求失败",
	"apiAiChat.unauthorized": "未登录或会话已过期",
	"apiAiChat.missingParams": "缺少必要参数",
	"apiAiChat.conversationNotFound": "对话不存在",
	"apiAiChat.attachmentPrefix": "\n\n📎 附件内容:\n\n",
	"apiAiChat.requestFailedFallback": "AI 请求失败",
	"apiAiChat.cannotReadStream": "无法读取响应流",
	"apiAiChat.streamErrorFallback": "流式传输错误",
	"apiAiChat.emptyContent": "(无响应内容)",
	"apiAiChat.waitingForApproval": "等待审批",
};

export const en: Record<string, string> = {
	"apiAiChat.rateLimited": "Too many requests, please try again later.",
	"apiAiChat.errorMessage": "AI request failed",
	"apiAiChat.unauthorized": "Not signed in or session expired",
	"apiAiChat.missingParams": "Missing required parameters",
	"apiAiChat.conversationNotFound": "Conversation not found",
	"apiAiChat.attachmentPrefix": "\n\n📎 Attachment contents:\n\n",
	"apiAiChat.requestFailedFallback": "AI request failed",
	"apiAiChat.cannotReadStream": "Cannot read response stream",
	"apiAiChat.streamErrorFallback": "Streaming error",
	"apiAiChat.emptyContent": "(no response content)",
	"apiAiChat.waitingForApproval": "Waiting for approval",
};
