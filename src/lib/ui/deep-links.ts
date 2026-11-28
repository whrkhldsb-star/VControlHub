/**
 * Canonical cross-page deep-link builders so every producer page, toast action,
 * GlobalSearch task item, and test emits the exact same query-parameter format.
 */

export function commandRequestHref(requestId: string): string {
	return `/requests?requestId=${encodeURIComponent(requestId)}`;
}

export function deploymentRunHref(deploymentId: string): string {
	return `/deployments?deploymentId=${encodeURIComponent(deploymentId)}`;
}

export function directCommandHref(options?: {
	serverId?: string;
	snippetId?: string;
	fromRequestId?: string;
}): string {
	const params = new URLSearchParams();
	if (options?.serverId) params.set("serverId", options.serverId);
	if (options?.snippetId) params.set("snippetId", options.snippetId);
	if (options?.fromRequestId) params.set("fromRequestId", options.fromRequestId);
	const query = params.toString();
	return query ? `/commands?${query}` : "/commands";
}

export function aiServerHref(serverId: string, prompt?: string): string {
	const params = new URLSearchParams({ server: serverId });
	if (prompt) params.set("q", prompt);
	return `/ai?${params.toString()}`;
}

export function aiConversationHref(conversationId: string, actionId?: string): string {
	const params = new URLSearchParams({ c: conversationId });
	if (actionId) params.set("action", actionId);
	return `/ai?${params.toString()}`;
}

export function operationTaskHref(taskId: string): string {
	return `/operation-tasks?task=${encodeURIComponent(taskId)}`;
}

export function aiProvidersHref(): string {
	return "/ai?panel=providers";
}

export function userCreateHref(teamId?: string | null): string {
	if (teamId) {
		return `/users?create=1&teamId=${encodeURIComponent(teamId)}`;
	}
	return "/users?create=1";
}

export function apiTokenCreateHref(): string {
	return "/api-tokens?create=1";
}
