"use client";

import { useState } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";

export function ConnectionTypeFields({
  sshKeys,
}: {
  sshKeys: Array<{
    id: string;
    name: string;
    fingerprint: string;
    description: string | null;
  }>;
}) {
  const { t } = useI18n();
  const [connectionType, setConnectionType] = useState<"SSH_KEY" | "PASSWORD">(
    "SSH_KEY",
  );
  return (
    <div className="space-y-4">
      {" "}
      <fieldset className="space-y-1.5">
        {" "}
        <legend className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide">
          {t("serversPage.create.connectionType")}
        </legend>{" "}
        <div className="flex gap-2">
          {" "}
          {(["SSH_KEY", "PASSWORD"] as const).map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={connectionType === type}
              onClick={() => setConnectionType(type)}
              className={`flex-1 rounded-lg border px-3.5 py-2 text-sm transition ${connectionType === type ? "border-[var(--color-action-border)]/20 bg-[var(--color-action-bg)]/[0.10] text-[var(--text-primary)] font-medium" : "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}
            >
              {" "}
              {type === "SSH_KEY"
                ? t("serversPage.create.sshKey")
                : t("serversPage.create.password")}{" "}
            </button>
          ))}{" "}
        </div>{" "}
        <input
          type="hidden"
          name="connectionType"
          value={connectionType}
        />{" "}
      </fieldset>{" "}
      {connectionType === "SSH_KEY" ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
          {" "}
          <div className="space-y-1.5">
            {" "}
            <label
              className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
              htmlFor="sshKeyId"
            >
              {t("serversPage.create.sshKey")}
            </label>{" "}
            <select
              id="sshKeyId"
              name="sshKeyId"
              required
              className={UI_INPUT}
            >
              {" "}
              <option value="">{t("serversPage.create.selectKey")}</option>{" "}
              {sshKeys.map((key) => (
                <option key={key.id} value={key.id}>
                  {" "}
                  {key.name}{" "}
                </option>
              ))}{" "}
            </select>{" "}
          </div>{" "}
          <div className="space-y-1.5">
            {" "}
            <label
              className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
              htmlFor="serverUsername"
            >
              {t("serversPage.create.username")}
            </label>{" "}
            <input
              key="ssh-key-username"
              id="serverUsername"
              name="username"
              type="text"
              defaultValue="root"
              placeholder="root"
              className={UI_INPUT}
            />{" "}
          </div>{" "}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {" "}
          <div className="space-y-1.5">
            {" "}
            <label
              className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
              htmlFor="serverUsername"
            >
              {t("serversPage.create.username")}
            </label>{" "}
            <input
              key="password-username"
              id="serverUsername"
              name="username"
              type="text"
              defaultValue="root"
              placeholder="root"
              className={UI_INPUT}
            />{" "}
          </div>{" "}
          <div className="space-y-1.5">
            {" "}
            <label
              className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
              htmlFor="serverPassword"
            >
              {t("serversPage.create.password")}
            </label>{" "}
            <input
              key="password-secret"
              id="serverPassword"
              name="password"
              type="password"
              defaultValue=""
              autoComplete="new-password"
              placeholder={t("serversPage.create.passwordPlaceholder")}
              className={UI_INPUT}
            />{" "}
            <p className="text-[11px] text-[var(--text-muted)]">
              {t("serversPage.create.passwordHint")}
            </p>{" "}
          </div>{" "}
        </div>
      )}{" "}
    </div>
  );
}
