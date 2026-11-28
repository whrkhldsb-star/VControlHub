"use client";

/**
 * `useAutomationMode` — the conversation's AI working mode: what is requested, what is in effect (platform
 * ceiling, the account's permissions, the Full auto window), and the changes made from the composer switcher,
 * the header, the settings panel and Shift+Tab. A change is saved at once with PATCH /api/ai/conversations/[id];
 * Full auto first asks for confirmation and a duration.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { getErrorMessage } from "@/lib/http/error-message";
import { useI18n } from "@/lib/i18n/use-locale";
import type { ToastFn } from "@/components/toast-provider";

import {
	type AiCapabilities,
	type AutomationMode,
	defaultFullAutoTtl,
	type EffectiveMode,
	modeLockReason,
	nextCycleMode,
	platformCeilingMode,
	resolveEffectiveMode,
} from "../ai-automation-mode";
import type { ConvItem } from "../ai-types";

/** The sentence that explains why a mode cannot be chosen. */
export function modeLockMessage(
	t: (key: string, vars?: Record<string, string | number>) => string,
	mode: AutomationMode,
	caps: AiCapabilities,
): string | null {
	const reason = modeLockReason(mode, caps);
	if (reason === "platform_ceiling") {
		return t("aiPage.mode.lock.platform_ceiling", { mode: t(`aiPage.mode.${platformCeilingMode(caps.aiMaxAutomationMode)}.label`) });
	}
	if (reason === "missing_permission") {
		const needed = [mode === "FULL_AUTO" ? "ai:action:full-auto" : "ai:action:auto", "command:execute"];
		return t("aiPage.mode.lock.missing_permission", { permission: needed.join(" + ") });
	}
	return null;
}

export type AutomationModeController = {
	requested: AutomationMode;
	effective: EffectiveMode;
	/** Server tools are on for this conversation: without them no mode applies. */
	hostingEnabled: boolean;
	busy: boolean;
	fullAutoDialogOpen: boolean;
	/** Choose a mode (Full auto opens its confirmation first). */
	requestMode: (mode: AutomationMode) => void;
	confirmFullAuto: (ttlMinutes: number) => Promise<void>;
	closeFullAutoDialog: () => void;
	dropToConfirm: () => void;
	/** Shift+Tab in the composer: true when it changed (or is about to change) the mode. */
	cycleMode: () => boolean;
	defaultTtlMinutes: number;
};

export function useAutomationMode({
	activeConv,
	caps,
	onConversationUpdated,
	addToast,
}: {
	activeConv: ConvItem | null;
	caps: AiCapabilities;
	/** The conversation as the PATCH returned it. */
	onConversationUpdated: (conversation: ConvItem) => void;
	addToast: ToastFn;
}): AutomationModeController {
	const { t } = useI18n();
	const [busy, setBusy] = useState(false);
	const [fullAutoDialogConvId, setFullAutoDialogConvId] = useState<string | null>(null);
	// Read in effects and handlers only: a render that read the clock would differ between server and browser.
	const [now, setNow] = useState<number | null>(null);
	const busyRef = useRef(false);
	// Where Shift+Tab stopped when it reached Full auto and its dialog was dismissed: the next press goes on from
	// there instead of opening the dialog again.
	const cycleCursorRef = useRef<AutomationMode | null>(null);

	const activeConvId = activeConv?.id ?? null;
	const [prevConvId, setPrevConvId] = useState<string | null>(activeConvId);
	if (prevConvId !== activeConvId) {
		setPrevConvId(activeConvId);
		if (fullAutoDialogConvId !== null) setFullAutoDialogConvId(null);
	}
	useEffect(() => {
		cycleCursorRef.current = null;
	}, [activeConvId]);

	const requested: AutomationMode = activeConv?.automationMode ?? "ASSISTED";
	const expiresAt = activeConv?.automationModeExpiresAt ?? null;
	const ticking = requested === "FULL_AUTO" && Boolean(expiresAt);

	useEffect(() => {
		if (!ticking) return;
		const update = () => setNow(Date.now());
		const first = setTimeout(update, 0);
		const timer = setInterval(update, 1_000);
		return () => {
			clearTimeout(first);
			clearInterval(timer);
		};
	}, [ticking, expiresAt]);

	const effective = useMemo(() => {
		const resolved = resolveEffectiveMode({ requested, expiresAt, caps, now: now ?? Number.NEGATIVE_INFINITY });
		// Until the first tick the window's length is unknown: no countdown, no expiry.
		return now === null ? { ...resolved, remainingMs: null } : resolved;
	}, [caps, expiresAt, now, requested]);

	const applyMode = useCallback(async (mode: AutomationMode, ttlMinutes?: number): Promise<boolean> => {
		if (!activeConv || busyRef.current) return false;
		const locked = modeLockMessage(t, mode, caps);
		if (locked) {
			addToast("error", locked);
			return false;
		}
		busyRef.current = true;
		setBusy(true);
		try {
			const body: Record<string, unknown> = { automationMode: mode };
			if (mode === "FULL_AUTO") body.automationModeTtlMinutes = ttlMinutes ?? defaultFullAutoTtl(caps);
			// A mode means nothing with the server tools off: choosing one turns them on.
			if (!activeConv.hostingEnabled) body.hostingEnabled = true;
			const data = await csrfFetch<{ conversation?: ConvItem }>(`/api/ai/conversations/${activeConv.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			if (data?.conversation) onConversationUpdated(data.conversation);
			cycleCursorRef.current = null;
			return true;
		} catch (error) {
			addToast("error", getErrorMessage(error, t("aiPage.mode.changeFailed")));
			return false;
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}, [activeConv, addToast, caps, onConversationUpdated, t]);

	const requestMode = useCallback((mode: AutomationMode) => {
		const locked = modeLockMessage(t, mode, caps);
		if (locked) {
			addToast("error", locked);
			return;
		}
		if (mode === "FULL_AUTO") {
			if (!activeConv) return;
			setFullAutoDialogConvId(activeConv.id);
			return;
		}
		if (mode === effective.effective && mode === requested && activeConv?.hostingEnabled) return;
		void applyMode(mode);
	}, [activeConv, addToast, applyMode, caps, effective.effective, requested, t]);

	const confirmFullAuto = useCallback(async (ttlMinutes: number) => {
		if (!activeConv || fullAutoDialogConvId !== activeConv.id) {
			setFullAutoDialogConvId(null);
			return;
		}
		if (await applyMode("FULL_AUTO", ttlMinutes)) setFullAutoDialogConvId(null);
	}, [activeConv, applyMode, fullAutoDialogConvId]);

	const closeFullAutoDialog = useCallback(() => {
		if (!busyRef.current) setFullAutoDialogConvId(null);
	}, []);

	const dropToConfirm = useCallback(() => {
		void applyMode("ASSISTED");
	}, [applyMode]);

	const cycleMode = useCallback((): boolean => {
		if (!activeConv?.hostingEnabled || busyRef.current) return false;
		const from = cycleCursorRef.current ?? effective.effective;
		const next = nextCycleMode(from, caps);
		if (!next) return false;
		if (next === "FULL_AUTO") {
			cycleCursorRef.current = "FULL_AUTO";
			setFullAutoDialogConvId(activeConv.id);
			return true;
		}
		cycleCursorRef.current = null;
		void applyMode(next);
		return true;
	}, [activeConv, applyMode, caps, effective.effective]);

	const fullAutoDialogOpen = Boolean(fullAutoDialogConvId && activeConv?.id === fullAutoDialogConvId);

	return {
		requested,
		effective,
		hostingEnabled: Boolean(activeConv?.hostingEnabled),
		busy,
		fullAutoDialogOpen,
		requestMode,
		confirmFullAuto,
		closeFullAutoDialog,
		dropToConfirm,
		cycleMode,
		defaultTtlMinutes: defaultFullAutoTtl(caps),
	};
}
