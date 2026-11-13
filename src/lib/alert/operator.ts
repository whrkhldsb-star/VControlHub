const SIGNS: Record<string, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=" };

/**
 * A rule's comparison as a sign, for sentences. Rules store a code ("gte"), and the notification messages and the
 * incident list printed the code itself: "CPU 使用率 gte 90". A value that is not a known code is shown as it is.
 */
export function alertOperatorSign(operator: string): string {
	return SIGNS[operator] ?? operator;
}
