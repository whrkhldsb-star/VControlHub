/**
 * ITSM/IM bidirectional integration types (FEAT-ITSM-IM-BIDI).
 *
 * Credentials never leave the service layer unencrypted.
 * Clients only see hasCredentials / last* metadata.
 */

export const ITSM_PROVIDER_VALUES = [
	"generic_webhook",
	"slack",
	"telegram",
	"dingtalk",
	"feishu",
] as const;
export type ItsmProvider = (typeof ITSM_PROVIDER_VALUES)[number];

export const ITSM_DIRECTION_VALUES = ["outbound", "inbound", "bidirectional"] as const;
export type ItsmDirection = (typeof ITSM_DIRECTION_VALUES)[number];

export const ITSM_EVENT_STATUS_VALUES = ["pending", "ok", "error", "ignored"] as const;
export type ItsmEventStatus = (typeof ITSM_EVENT_STATUS_VALUES)[number];

export const ITSM_EVENT_DIRECTION_VALUES = ["inbound", "outbound"] as const;
export type ItsmEventDirection = (typeof ITSM_EVENT_DIRECTION_VALUES)[number];

/** Plain config (no secrets). */
export type ItsmConnectionConfig = {
	/** Outbound HTTPS webhook URL (required for outbound-capable providers). */
	webhookUrl?: string;
	/** Telegram chat id / Slack channel label / display target */
	chatId?: string;
	/** Default priority for inbound-created tickets */
	defaultPriority?: string;
	/** Default category for inbound-created tickets */
	defaultCategory?: string;
	/** When true, inbound ticket.create creates a local Ticket row */
	createOnInbound?: boolean;
	/** Optional static headers (no secrets) for generic webhook */
	headers?: Record<string, string>;
	/** Optional template note / workspace label */
	workspace?: string;
};

export type ItsmCredentials = {
	/** Shared HMAC secret for inbound signature verification */
	webhookSecret?: string;
	/** Bot token (Telegram) or app secret */
	botToken?: string;
	/** Provider signing secret (Slack/Feishu style) */
	signingSecret?: string;
	/** Optional API token / access key */
	accessToken?: string;
};

export interface ItsmConnectionRecord {
	id: string;
	name: string;
	provider: ItsmProvider;
	direction: ItsmDirection;
	enabled: boolean;
	config: ItsmConnectionConfig;
	hasCredentials: boolean;
	teamId: string | null;
	lastOutboundAt: string | null;
	lastInboundAt: string | null;
	lastError: string | null;
	createdById: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface ItsmEventRecord {
	id: string;
	connectionId: string | null;
	direction: ItsmEventDirection;
	eventType: string;
	ticketId: string | null;
	status: ItsmEventStatus;
	externalId: string | null;
	payload: Record<string, unknown>;
	errorMessage: string | null;
	createdAt: string;
}

export type ItsmOutboundTicketPayload = {
	ticketId: string;
	title: string;
	description: string;
	status: string;
	priority: string;
	category?: string | null;
	eventType: string;
	commentBody?: string;
};

export type ItsmOutboundResult = {
	ok: boolean;
	statusCode?: number;
	error?: string;
	responseBody?: string;
};
