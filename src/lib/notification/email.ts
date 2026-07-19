import nodemailer from "nodemailer";

import { ValidationError } from "@/lib/errors";
import { timeDelivery } from "@/lib/monitoring/runtime-metrics";
import { getAllSettings } from "@/lib/settings/service";

export type EmailDeliveryInput = {
	to: string | string[];
	subject: string;
	text: string;
	html?: string;
};

export type SmtpConfig = {
	enabled: boolean;
	host: string;
	port: number;
	user: string;
	pass: string;
	from: string;
};

export type EmailDeliveryResult = {
	accepted: string[];
	rejected: string[];
	messageId?: string;
};

export function parseAlertEmailRecipients(value: string | undefined | null) {
	return String(value ?? "")
		.split(/[\n,;，；]+/)
		.map((recipient) => recipient.trim())
		.filter(Boolean);
}

function parseSmtpPort(value: string | undefined) {
	const port = Number(value || "587");
	return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : 587;
}

function normalizeRecipients(to: string | string[]) {
	return (Array.isArray(to) ? to : [to])
		.map((recipient) => recipient.trim())
		.filter(Boolean);
}

function isTruthySetting(value: string | undefined) {
	return ["true", "1", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

export async function getSmtpConfig(): Promise<SmtpConfig> {
	const settings = await getAllSettings();
	return {
		enabled: isTruthySetting(settings["smtp.enabled"]),
		host: settings["smtp.host"]?.trim() ?? "",
		port: parseSmtpPort(settings["smtp.port"]),
		user: settings["smtp.user"]?.trim() ?? "",
		pass: settings["smtp.pass"] ?? "",
		from: settings["smtp.from"]?.trim() ?? "",
	};
}

export function assertSmtpReady(config: SmtpConfig) {
	if (!config.enabled) throw new ValidationError("SMTP channel is not enabled");
	if (!config.host) throw new ValidationError("SMTP host is not configured");
	if (!config.from) throw new ValidationError("SMTP sender is not configured");
}

export async function sendEmail(input: EmailDeliveryInput): Promise<EmailDeliveryResult> {
	return timeDelivery("email", async () => {
		const config = await getSmtpConfig();
		assertSmtpReady(config);

		const recipients = normalizeRecipients(input.to);
		if (recipients.length === 0) throw new ValidationError("Email recipients are not configured");

		const transporter = nodemailer.createTransport({
			host: config.host,
			port: config.port,
			secure: config.port === 465,
			auth: config.user || config.pass ? { user: config.user, pass: config.pass } : undefined,
			connectionTimeout: 10_000,
			greetingTimeout: 10_000,
			socketTimeout: 30_000,
		});
		const result = await transporter.sendMail({
			from: config.from,
			to: recipients,
			subject: input.subject,
			text: input.text,
			html: input.html,
		});

		return {
			accepted: (result.accepted ?? []).map(String),
			rejected: (result.rejected ?? []).map(String),
			messageId: result.messageId,
		};
	});
}

export async function sendAlertEmail(input: {
	title: string;
	message: string;
	contextLines?: string[];
}) {
	const settings = await getAllSettings();
	const recipients = parseAlertEmailRecipients(settings["smtp.alertRecipients"]);
	if (recipients.length === 0) {
		throw new ValidationError("SMTP alert recipients are not configured");
	}
	const body = [input.message, ...(input.contextLines ?? [])]
		.filter(Boolean)
		.join("\n");
	return sendEmail({
		to: recipients,
		subject: input.title,
		text: body,
	});
}
