/**
 * Canonical cross-page deep-link builders so every producer page, toast action,
 * GlobalSearch task item, and test emits the exact same query-parameter format.
 */

export function commandRequestHref(requestId: string): string {
	return `/requests?requestId=${encodeURIComponent(requestId)}`;
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
