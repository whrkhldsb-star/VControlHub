export * from "./field-schema-core";

import { type SectionDef } from "./field-schema-core";
import { BASE_SETTINGS_SECTIONS } from "./field-schema-base";
import { NOTIFICATION_SETTINGS_SECTIONS } from "./field-schema-notifications";
import { AI_OPS_SETTINGS_SECTIONS, DASHBOARD_SETTINGS_SECTIONS, OFFSITE_SETTINGS_SECTIONS } from "./field-schema-offsite";
import {
	AI_SETTINGS_SECTIONS,
	ALERT_SETTINGS_SECTIONS,
	MONITORING_SETTINGS_SECTIONS,
	OPERATIONS_SETTINGS_SECTIONS,
	SECURITY_POLICY_SETTINGS_SECTIONS,
	STORAGE_SETTINGS_SECTIONS,
} from "./field-schema-platform-ops";

export const SETTINGS_SCHEMA: SectionDef[] = [
	...BASE_SETTINGS_SECTIONS,
	...NOTIFICATION_SETTINGS_SECTIONS,
	...DASHBOARD_SETTINGS_SECTIONS,
	...OFFSITE_SETTINGS_SECTIONS,
	...AI_OPS_SETTINGS_SECTIONS,
	...SECURITY_POLICY_SETTINGS_SECTIONS,
	...OPERATIONS_SETTINGS_SECTIONS,
	...ALERT_SETTINGS_SECTIONS,
	...STORAGE_SETTINGS_SECTIONS,
	...MONITORING_SETTINGS_SECTIONS,
	...AI_SETTINGS_SECTIONS,
];

/* ── Helpers ────────────────────────────────────────────── */

export function getSectionSaveKeys(section: SectionDef): string[] {
	if (section.custom) return [];
	return section.fields.map((f) => f.key);
}
