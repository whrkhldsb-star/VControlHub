import type { Dispatch, SetStateAction } from "react";

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
}
