"use client";

import { useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { Dialog } from "@/components/ui/dialog";
import { CheckboxField, FormField, Notice } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";
import { useUnsavedChangesGuard } from "@/lib/forms/use-unsaved-changes-guard";

interface Announcement {
  id: string;
  title: string;
  body: string;
  level: string;
  pinned: boolean;
  published?: boolean;
  startsAt: string;
  expiresAt: string | null;
}

/** ISO → value for <input type="datetime-local"> in the viewer's clock. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function AnnouncementEditModal({
  announcement,
  onClose,
  onSaved,
}: {
  announcement: Announcement;
  onClose: () => void;
  onSaved: (updated: Announcement) => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(announcement.title);
  const [content, setContent] = useState(announcement.body);
  const [level, setLevel] = useState(announcement.level);
  const [pinned, setPinned] = useState(announcement.pinned);
  // Publication state and validity window are editable too (A8-03): taking an
  // announcement offline or extending it used to mean delete and re-create.
  const [published, setPublished] = useState(announcement.published !== false);
  const [startsAt, setStartsAt] = useState(toLocalInput(announcement.startsAt));
  const [expiresAt, setExpiresAt] = useState(toLocalInput(announcement.expiresAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const savingRef = useRef(false);
  const dirty =
    title !== announcement.title ||
    content !== announcement.body ||
    level !== announcement.level ||
    pinned !== announcement.pinned ||
    published !== (announcement.published !== false) ||
    startsAt !== toLocalInput(announcement.startsAt) ||
    expiresAt !== toLocalInput(announcement.expiresAt);
  const { requestDiscard, discardDialog } = useUnsavedChangesGuard({
    dirty,
    onDiscard: onClose,
  });

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const data = await csrfFetch<{ announcement: Announcement }>("/api/announcements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: announcement.id, title, content, type: level, pinned, published,
          ...(startsAt && startsAt !== toLocalInput(announcement.startsAt) ? { startsAt: new Date(startsAt).toISOString() } : {}),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      onSaved(data.announcement);
      onClose();
    } catch (e: unknown) {
      setError(getErrorMessage(e, t("announcementsPage.edit.failFallback")));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog
      size="lg"
      open
      onClose={requestDiscard}
      closeOnBackdrop={false}
      busy={saving}
      title={t("announcementsPage.edit.title")}
      footer={<>
        <ActionButton type="button" variant="secondary" onClick={requestDiscard}>
          {t("common.cancel")}
        </ActionButton>
        <ActionButton type="button" onClick={handleSave} loading={saving} disabled={!title.trim() || !content.trim()}>
          {saving ? t("announcementsPage.edit.saving") : t("announcementsPage.edit.submit")}
        </ActionButton>
      </>}
    >
      <div className="space-y-4">
        {error ? <Notice tone="danger" compact>{error}</Notice> : null}
        <FormField label={t("announcementsPage.edit.titleLabel")} htmlFor="announcementTitle">
          <input id="announcementTitle" value={title} onChange={(e) => setTitle(e.target.value)} className={UI_INPUT} />
        </FormField>
        <FormField label={t("common.level")} htmlFor="announcementLevel">
          <select id="announcementLevel" value={level} onChange={(e) => setLevel(e.target.value)} className={UI_INPUT}>
            <option value="info">{t("announcementsPage.level.info")}</option>
            <option value="warning">{t("announcementsPage.level.warning")}</option>
            <option value="urgent">{t("announcementsPage.level.urgent")}</option>
          </select>
        </FormField>
        <FormField label={t("announcementsPage.edit.content")} htmlFor="announcementContent">
          <textarea id="announcementContent" value={content} onChange={(e) => setContent(e.target.value)} rows={5} className={UI_INPUT} />
        </FormField>
        <CheckboxField label={t("common.pinned")} checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
        <CheckboxField label={t("announcementsPage.edit.published")} checked={published} onChange={(e) => setPublished(e.target.checked)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("announcementsPage.edit.startsAt")} htmlFor="announcementStartsAt">
            <input id="announcementStartsAt" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={UI_INPUT} />
          </FormField>
          <FormField label={t("announcementsPage.edit.expiresAt")} htmlFor="announcementExpiresAt">
            <input id="announcementExpiresAt" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={UI_INPUT} />
          </FormField>
        </div>
      </div>
      {discardDialog}
    </Dialog>
  );
}
