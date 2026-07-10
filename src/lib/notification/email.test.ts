import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAllSettingsMock, sendMailMock, createTransportMock } = vi.hoisted(() => ({
	getAllSettingsMock: vi.fn(),
	sendMailMock: vi.fn(),
	createTransportMock: vi.fn(),
}));

vi.mock("@/lib/settings/service", () => ({ getAllSettings: getAllSettingsMock }));
vi.mock("nodemailer", () => ({
	default: {
		createTransport: createTransportMock,
	},
}));

const { parseAlertEmailRecipients, sendAlertEmail, sendEmail } = await import("./email");

describe("email notification delivery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getAllSettingsMock.mockResolvedValue({
			"smtp.enabled": "true",
			"smtp.host": "smtp.example.com",
			"smtp.port": "587",
			"smtp.user": "mailer@example.com",
			"smtp.pass": "secret",
			"smtp.from": "noreply@example.com",
			"smtp.alertRecipients": "ops@example.com, admin@example.com",
		});
		sendMailMock.mockResolvedValue({
			accepted: ["ops@example.com", "admin@example.com"],
			rejected: [],
			messageId: "msg-1",
		});
		createTransportMock.mockReturnValue({ sendMail: sendMailMock });
	});

	it("parses alert recipients from commas, semicolons, and newlines", () => {
		expect(parseAlertEmailRecipients("ops@example.com; admin@example.com\nqa@example.com，dev@example.com")).toEqual([
			"ops@example.com",
			"admin@example.com",
			"qa@example.com",
			"dev@example.com",
		]);
	});

	it("sends SMTP mail with persisted settings", async () => {
		const result = await sendEmail({
			to: ["ops@example.com"],
			subject: "Alert",
			text: "Body",
		});

		expect(createTransportMock).toHaveBeenCalledWith({
			host: "smtp.example.com",
			port: 587,
			secure: false,
			auth: { user: "mailer@example.com", pass: "secret" },
		});
		expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
			from: "noreply@example.com",
			to: ["ops@example.com"],
			subject: "Alert",
			text: "Body",
		}));
		expect(result).toEqual({ accepted: ["ops@example.com", "admin@example.com"], rejected: [], messageId: "msg-1" });
	});

	it("sends alert emails to the configured alert recipients", async () => {
		await sendAlertEmail({
			title: "CPU high",
			message: "Prod CPU high",
			contextLines: ["服务器: Prod"],
		});

		expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
			to: ["ops@example.com", "admin@example.com"],
			subject: "CPU high",
			text: "Prod CPU high\n服务器: Prod",
		}));
	});

	it("rejects alert email delivery when recipients are not configured", async () => {
		getAllSettingsMock.mockResolvedValueOnce({
			"smtp.enabled": "true",
			"smtp.host": "smtp.example.com",
			"smtp.port": "587",
			"smtp.from": "noreply@example.com",
			"smtp.alertRecipients": "",
		});

		await expect(sendAlertEmail({ title: "CPU high", message: "Body" })).rejects.toThrow("SMTP alert recipients are not configured");
		expect(sendMailMock).not.toHaveBeenCalled();
	});
});
