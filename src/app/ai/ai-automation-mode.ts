/**
 * Client-side mirror of the AI execution-mode rules (`@/lib/ai/execution-mode`).
 *
 * The page cannot import the server module (it pulls the authorization and
 * risk-classifier graph into the browser bundle), so the server component
 * resolves the account's capabilities once and hands them to the client as
 * plain values. Everything here is pure: the server stays the authority and
 * re-resolves the mode on every request; these helpers only decide what the
 * switcher offers and how a downgrade is explained.
 *
 * Hierarchy: PLAN_ONLY (0) < ASSISTED (1) < AUTO (2) < FULL_AUTO (3).
 */

export type AutomationMode = "PLAN_ONLY" | "ASSISTED" | "AUTO" | "FULL_AUTO";
export type MaxAutomationSetting = "plan" | "confirm" | "auto" | "full_auto";
export type SelfReviewPolicy = "platform_admins" | "approvers";
export type AiCommandPolicy = "always" | "high_risk" | "never";

export const AUTOMATION_MODES: readonly AutomationMode[] = ["PLAN_ONLY", "ASSISTED", "AUTO", "FULL_AUTO"];

const MODE_RANK: Record<AutomationMode, number> = { PLAN_ONLY: 0, ASSISTED: 1, AUTO: 2, FULL_AUTO: 3 };

/** What the signed-in account may do with the assistant, resolved on the server (page.tsx). */
export type AiCapabilities = {
	/** `ai:action:auto` */
	canAuto: boolean;
	/** `ai:action:full-auto` */
	canFullAuto: boolean;
	/** `command:execute`: without it every mode above Confirm falls back to Confirm. */
	canExecute: boolean;
	/** `command:approve`: with the `approvers` self-review policy, the account reviews its own requests. */
	canApprove: boolean;
	/** `server:read`: the pinned-server picker lists servers only with it. */
	canReadServers: boolean;
	/** The platform ceiling (`ai.maxAutomationMode`). */
	aiMaxAutomationMode: MaxAutomationSetting;
	selfReviewPolicy: SelfReviewPolicy;
	/** Manages every customer (`team:manage`): may always review its own command requests. */
	isPlatformAdmin: boolean;
	/** The approval policy that applies to AI chat commands (`inherit` already resolved). */
	aiCommandPolicy: AiCommandPolicy;
	/** Whether Full auto may run commands classified as critical. */
	fullAutoAllowCritical: boolean;
	maxFullAutoTtlMinutes: number;
	defaultFullAutoTtlMinutes: number;
};

/** Conservative defaults for call sites (and tests) that pass no capabilities: Plan and Confirm only. */
export const DEFAULT_AI_CAPABILITIES: AiCapabilities = {
	canAuto: false,
	canFullAuto: false,
	canExecute: false,
	canApprove: false,
	canReadServers: false,
	aiMaxAutomationMode: "confirm",
	selfReviewPolicy: "platform_admins",
	isPlatformAdmin: false,
	aiCommandPolicy: "always",
	fullAutoAllowCritical: false,
	maxFullAutoTtlMinutes: 60,
	defaultFullAutoTtlMinutes: 30,
};

export function modeRank(mode: AutomationMode): number {
	return MODE_RANK[mode] ?? MODE_RANK.ASSISTED;
}

export function isAutomationMode(value: unknown): value is AutomationMode {
	return typeof value === "string" && (AUTOMATION_MODES as readonly string[]).includes(value);
}

export function platformCeilingMode(setting: MaxAutomationSetting): AutomationMode {
	switch (setting) {
		case "plan":
			return "PLAN_ONLY";
		case "auto":
			return "AUTO";
		case "full_auto":
			return "FULL_AUTO";
		case "confirm":
		default:
			return "ASSISTED";
	}
}

/** Mirrors `userModeCeiling`: `ai:action:full-auto` implies Auto, and both need `command:execute`. */
export function userCeilingMode(caps: AiCapabilities): AutomationMode {
	if (!caps.canExecute) return "ASSISTED";
	if (caps.canFullAuto) return "FULL_AUTO";
	if (caps.canAuto) return "AUTO";
	return "ASSISTED";
}

export type ModeLockReason = "platform_ceiling" | "missing_permission";

/** Why a mode cannot be chosen, or null when it can. The platform ceiling is named first, as the server does. */
export function modeLockReason(mode: AutomationMode, caps: AiCapabilities): ModeLockReason | null {
	const rank = modeRank(mode);
	if (rank > modeRank(platformCeilingMode(caps.aiMaxAutomationMode))) return "platform_ceiling";
	if (rank > modeRank(userCeilingMode(caps))) return "missing_permission";
	return null;
}

export function permittedModes(caps: AiCapabilities): AutomationMode[] {
	return AUTOMATION_MODES.filter((mode) => modeLockReason(mode, caps) === null);
}

export type EffectiveModeReason = "expired" | ModeLockReason;

export type EffectiveMode = {
	requested: AutomationMode;
	effective: AutomationMode;
	downgraded: boolean;
	reasons: EffectiveModeReason[];
	/** Epoch ms at which a Full auto window ends, when one is set. */
	expiresAt: number | null;
	/** Time left in an active Full auto window. */
	remainingMs: number | null;
};

function parseTime(value: string | null | undefined): number | null {
	if (!value) return null;
	const time = Date.parse(value);
	return Number.isNaN(time) ? null : time;
}

/** Mirrors `resolveEffectiveAutomationMode`: expiry first, then the platform ceiling, then the account's own. */
export function resolveEffectiveMode(input: {
	requested: AutomationMode | null | undefined;
	expiresAt?: string | null;
	caps: AiCapabilities;
	now: number;
}): EffectiveMode {
	const requested = isAutomationMode(input.requested) ? input.requested : "ASSISTED";
	const reasons: EffectiveModeReason[] = [];
	let rank = modeRank(requested);
	const expiresAt = requested === "FULL_AUTO" ? parseTime(input.expiresAt) : null;
	if (expiresAt !== null && expiresAt <= input.now) {
		rank = Math.min(rank, MODE_RANK.ASSISTED);
		reasons.push("expired");
	}
	const platform = modeRank(platformCeilingMode(input.caps.aiMaxAutomationMode));
	if (rank > platform) {
		rank = platform;
		reasons.push("platform_ceiling");
	}
	const user = modeRank(userCeilingMode(input.caps));
	if (rank > user) {
		rank = user;
		reasons.push("missing_permission");
	}
	const effective = AUTOMATION_MODES[rank] ?? "ASSISTED";
	const active = effective === "FULL_AUTO" && expiresAt !== null && expiresAt > input.now;
	return {
		requested,
		effective,
		downgraded: effective !== requested,
		reasons,
		expiresAt,
		remainingMs: active ? expiresAt - input.now : null,
	};
}

/**
 * The mode Shift+Tab moves to: the next permitted one after `current`, wrapping around.
 * Null when there is nothing to cycle between.
 */
export function nextCycleMode(current: AutomationMode, caps: AiCapabilities): AutomationMode | null {
	const modes = permittedModes(caps);
	if (modes.length < 2) return null;
	const index = modes.indexOf(current);
	if (index === -1) return modes[0] ?? null;
	return modes[(index + 1) % modes.length] ?? null;
}

const FULL_AUTO_TTL_CHOICES = [15, 30, 60] as const;

/** The Full auto windows offered, capped by the platform's maximum. */
export function fullAutoTtlOptions(maxMinutes: number): number[] {
	const max = Number.isFinite(maxMinutes) && maxMinutes > 0 ? Math.floor(maxMinutes) : 60;
	const options = FULL_AUTO_TTL_CHOICES.filter((minutes) => minutes <= max);
	return options.length > 0 ? [...options] : [Math.max(5, max)];
}

/** The option preselected in the Full auto dialog: the default when offered, else the longest allowed. */
export function defaultFullAutoTtl(caps: Pick<AiCapabilities, "defaultFullAutoTtlMinutes" | "maxFullAutoTtlMinutes">): number {
	const options = fullAutoTtlOptions(caps.maxFullAutoTtlMinutes);
	if (options.includes(caps.defaultFullAutoTtlMinutes)) return caps.defaultFullAutoTtlMinutes;
	return options[options.length - 1] ?? 15;
}

/** "mm:ss", or "h:mm:ss" past the hour. */
export function formatCountdown(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	const pad = (value: number) => String(value).padStart(2, "0");
	return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

const COMMAND_ACTION_TYPES = new Set(["execute_command", "restart_service", "modify_config", "deploy_docker"]);

/** Whether a hosted action becomes a CommandRequest on confirmation (and so can run inline or go to review). */
export function isCommandActionType(actionType: string): boolean {
	return COMMAND_ACTION_TYPES.has(actionType);
}

/**
 * Best guess, for a card restored from history (the stream's `willExecuteInline` is gone), whether confirming
 * runs the command right away or files it for another reviewer. Mirrors decideCommandApproval +
 * maySelfReviewCommands; the confirmation's answer is what the page reports afterwards.
 */
export function predictInlineExecution(input: {
	caps: AiCapabilities;
	riskLevel: string;
	denylisted?: boolean;
}): boolean {
	const { caps } = input;
	if (!caps.canExecute) return false;
	const risk = input.riskLevel.toLowerCase();
	const highOrCritical = risk === "high" || risk === "critical";
	const requiresApproval = caps.aiCommandPolicy === "always"
		|| (Boolean(input.denylisted) && caps.aiCommandPolicy !== "never")
		|| (caps.aiCommandPolicy === "high_risk" && highOrCritical);
	if (!requiresApproval) return true;
	return caps.isPlatformAdmin || (caps.selfReviewPolicy === "approvers" && caps.canApprove);
}
