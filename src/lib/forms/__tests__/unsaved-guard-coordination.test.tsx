import Link from "next/link";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { useUnsavedChangesGuard } from "../use-unsaved-changes-guard";
import { resetActiveWorkRegistryForTests } from "../active-work-guard";
import { useNotificationLink } from "@/lib/notification/use-notification-link";
import { csrfFetch } from "@/lib/auth/csrf-client";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

vi.mock("@/lib/auth/session-context", () => ({
	useSessionGate: () => ({
		userId: "admin_1",
		roles: ["admin"],
		currentTeamId: "team_a",
	}),
}));

vi.mock("@/components/toast-provider", () => ({
	useToast: () => ({ addToast: vi.fn() }),
	ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

function TwoDirtyForms() {
	const first = useUnsavedChangesGuard({ dirty: true });
	const second = useUnsavedChangesGuard({ dirty: true });
	return (
		<div>
			{first.discardDialog}
			{second.discardDialog}
		</div>
	);
}

function DirtyFormWithCrossCustomerNotification() {
	const guard = useUnsavedChangesGuard({ dirty: true });
	const { wouldSwitch, onOpen, switchDialog } = useNotificationLink();
	const notification = {
		teamId: "team_b",
		teamName: "Beta Corp",
		actionUrl: "/tickets/t1",
	};
	return (
		<div>
			<Link
				href="/tickets/t1"
				data-scope-switch-link={wouldSwitch(notification) ? "true" : undefined}
				onClick={onOpen(notification)}
			>
				Open cross-customer ticket
			</Link>
			{guard.discardDialog}
			{switchDialog}
		</div>
	);
}

describe("useUnsavedChangesGuard coordination", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetActiveWorkRegistryForTests();
		window.history.replaceState({}, "", "/settings");
	});

	afterEach(() => {
		resetActiveWorkRegistryForTests();
	});

	it("opens a single dialog and calls history.go(-2) once when two dirty forms are mounted and Back fires", async () => {
		const user = userEvent.setup();
		const goSpy = vi.spyOn(window.history, "go").mockImplementation(() => undefined);

		render(<TwoDirtyForms />, { locale: "en" });

		fireEvent(window, new PopStateEvent("popstate"));

		const dialogs = screen.getAllByRole("dialog");
		expect(dialogs).toHaveLength(1);
		await user.click(within(dialogs[0]!).getByRole("button", { name: "Discard and leave" }));

		expect(goSpy).toHaveBeenCalledTimes(1);
		expect(goSpy).toHaveBeenCalledWith(-2);
		goSpy.mockRestore();
	});

	it("opens only the scope-switch confirmation for cross-customer notification links with a dirty form", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValue({ ok: true });

		render(<DirtyFormWithCrossCustomerNotification />, { locale: "en" });

		await user.click(screen.getByRole("link", { name: "Open cross-customer ticket" }));

		// Only the scope-switch dialog appears — NOT a second unsaved-changes navigation dialog.
		const dialogs = screen.getAllByRole("dialog");
		expect(dialogs).toHaveLength(1);
		expect(dialogs[0]).toHaveTextContent("Beta Corp");
		expect(pushMock).not.toHaveBeenCalled();

		// Cancelling leaves the user on the current page without navigating in the old customer.
		await user.click(within(dialogs[0]!).getByRole("button", { name: "Cancel" }));
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(pushMock).not.toHaveBeenCalled();
		expect(csrfFetch).not.toHaveBeenCalled();
	});
});
