import type { Dispatch, SetStateAction } from "react";

import type { AiCapabilities, AutomationMode } from "./ai-automation-mode";
import type { ModelInfo } from "./ai-types";

export interface SettingsFormState {
	model: string;
	systemPrompt: string;
	temperature: number;
	maxTokens: number;
	topP: number;
	frequencyPenalty: number;
	presencePenalty: number;
	enableVision: boolean;
	hostingEnabled: boolean;
	/** Mirrors the conversation: the mode is changed through `onRequestMode`, at once, never by "Save settings". */
	automationMode: AutomationMode;
}

export interface SettingsPanelProps {
	show: boolean;
	settingsForm: SettingsFormState;
	setSettingsForm: Dispatch<SetStateAction<SettingsFormState>>;
	modelList: ModelInfo[];
	modelsLoading: boolean;
	modelDropdownOpen: boolean;
	setModelDropdownOpen: Dispatch<SetStateAction<boolean>>;
	modelSearch: string;
	setModelSearch: Dispatch<SetStateAction<string>>;
	currentModelSupportsVision: boolean;
	onSaveSettings: () => void;
	onRefreshModels: () => void;
	/** What the account may choose; the panel locks the rest. Defaults to Plan and Confirm only. */
	capabilities?: AiCapabilities;
	/** Switch the conversation's mode now (Full auto asks for confirmation first). */
	onRequestMode?: (mode: AutomationMode) => void;
	/** A mode change is being saved. */
	modeBusy?: boolean;
}
