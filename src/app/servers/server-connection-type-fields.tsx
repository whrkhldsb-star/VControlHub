"use client";

import { useState } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { SegmentedControl } from "@/components/ui-primitives";
import { UI_INPUT, UI_LABEL } from "@/lib/ui/classes";

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
    <section data-tile className="space-y-4 p-4">
      {" "}
      <div className="space-y-1.5">
        <span className={UI_LABEL}>{t("serversPage.create.connectionType")}</span>
        <SegmentedControl
          block
          ariaLabel={t("serversPage.create.connectionType")}
          value={connectionType}
          onChange={setConnectionType}
          options={[
            { value: "SSH_KEY", label: t("serversPage.create.sshKey") },
            { value: "PASSWORD", label: t("serversPage.create.password") },
          ]}
        />
        <input
          type="hidden"
          name="connectionType"
          value={connectionType}
        />
      </div>
      {connectionType === "SSH_KEY" ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
          {" "}
          <div className="space-y-1.5">
            {" "}
            <label
              className="ui-label"
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
              className="ui-label"
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
              className="ui-label"
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
              className="ui-label"
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
            <p className="text-xs text-[var(--text-muted)]">
              {t("serversPage.create.passwordHint")}
            </p>{" "}
          </div>{" "}
        </div>
      )}{" "}
    </section>
  );
}
