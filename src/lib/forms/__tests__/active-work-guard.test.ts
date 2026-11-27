import { afterEach, describe, expect, it } from "vitest";
import {
	acquireDirtyHistoryGuard,
	beginScopeSwitchRelease,
	endScopeSwitchRelease,
	finishScopeSwitchRelease,
	formatActiveWorkSummary,
	getActiveWorkSnapshot,
	isScopeSwitchReleasing,
	registerActiveWork,
	releaseDirtyHistoryGuard,
	resetActiveWorkRegistryForTests,
	subscribeActiveWork,
} from "../active-work-guard";

describe("active-work-guard", () => {
	afterEach(() => {
		resetActiveWorkRegistryForTests();
	});

	it("tracks dirty forms, uploads and terminals with unregister cleanup", () => {
		const calls: number[] = [];
		const unsub = subscribeActiveWork(() => calls.push(1));

		const unregForm = registerActiveWork("dirtyForm", 1);
		const unregUpload = registerActiveWork("upload", 2);
		const unregTerm = registerActiveWork("terminal", 1);

		expect(getActiveWorkSnapshot()).toEqual({
			dirtyForms: 1,
			activeUploads: 2,
			openTerminals: 1,
			hasAny: true,
		});

		unregUpload();
		expect(getActiveWorkSnapshot()).toEqual({
			dirtyForms: 1,
			activeUploads: 0,
			openTerminals: 1,
			hasAny: true,
		});

		unregForm();
		unregTerm();
		expect(getActiveWorkSnapshot().hasAny).toBe(false);
		expect(calls.length).toBeGreaterThanOrEqual(4);
		unsub();
	});

	it("handles scope-switch release and rollback on error", () => {
		expect(isScopeSwitchReleasing()).toBe(false);
		beginScopeSwitchRelease();
		expect(isScopeSwitchReleasing()).toBe(true);
		endScopeSwitchRelease();
		expect(isScopeSwitchReleasing()).toBe(false);

		beginScopeSwitchRelease();
		finishScopeSwitchRelease(10);
		expect(isScopeSwitchReleasing()).toBe(true);
	});

	it("ref-counts dirty history guards across multiple forms", () => {
		expect(acquireDirtyHistoryGuard()).toBe(1);
		expect(acquireDirtyHistoryGuard()).toBe(2);
		expect(releaseDirtyHistoryGuard()).toBe(1);
		expect(releaseDirtyHistoryGuard()).toBe(0);
	});

	it("formats localized active work summaries", () => {
		const t = (key: string, vars?: Record<string, string | number>) => {
			if (key === "common.listSeparator") return ", ";
			return `${key}:${vars?.count ?? ""}`;
		};
		const summary = formatActiveWorkSummary(
			{ dirtyForms: 1, activeUploads: 2, openTerminals: 3, hasAny: true },
			t,
		);
		expect(summary).toBe(
			"nav.customerSwitchItem.terminals:3, nav.customerSwitchItem.uploads:2, nav.customerSwitchItem.forms:1",
		);
	});
});
