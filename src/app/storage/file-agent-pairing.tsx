"use client";

import { useState, useTransition } from "react";
import { ActionButton } from "@/components/action-button";
import { useI18n } from "@/lib/i18n/use-locale";
import { thrownActionMessage } from "@/lib/http/error-message";
import { pairFileAgentAction } from "./actions-nodes";

export function FileAgentPairing({ nodeId }: { nodeId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="mt-3">
      <ActionButton
        variant="secondary"
        size="sm"
        aria-expanded={open}
        disabled={pending}
        onClick={() => {
          setConfig("");
          setError("");
          setOpen(!open);
        }}
      >
        {t(open ? "storagePage.agent.close" : "storagePage.agent.pair")}
      </ActionButton>
      {open && (
        <div className="space-y-2 pt-2 text-sm">
          {config ? (
            <>
              <p>{t("storagePage.agent.config")}</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all" dir="ltr">
                {config}
              </pre>
            </>
          ) : (
            <>
              <p>{t("storagePage.agent.rotate")}</p>
              <ActionButton
                size="sm"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    try {
                      const token = await pairFileAgentAction(nodeId);
                      setConfig(
                        JSON.stringify({ hub: window.location.origin, token, root: "", writable: false }, null, 2),
                      );
                    } catch (e) {
                      setError(thrownActionMessage(e, t, t("storagePage.list.checkFailed")) ?? "");
                    }
                  })
                }
              >
                {t("storagePage.agent.generate")}
              </ActionButton>
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
