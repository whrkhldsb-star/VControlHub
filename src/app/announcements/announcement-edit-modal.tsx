"use client";

import { useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

interface Announcement {
  id: string;
  title: string;
  body: string;
  level: string;
  pinned: boolean;
  startsAt: string;
  expiresAt: string | null;
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const data = await csrfFetch<{ announcement: Announcement }>("/api/announcements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: announcement.id, title, content, type: level, pinned }),
      });
      onSaved(data.announcement);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("announcementsPage.edit.failFallback"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[var(--modal-bg)] p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-white">{t("announcementsPage.edit.title")}</h3>

        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs text-slate-400" htmlFor="announcementTitle">{t("announcementsPage.edit.titleLabel")}</label>
            <input
              id="announcementTitle"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400" htmlFor="announcementLevel">{t("common.level")}</label>
            <select
              id="announcementLevel"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              data-input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            >
              <option value="info">{t("announcementsPage.edit.severity.info")}</option>
              <option value="warning">{t("announcementsPage.edit.severity.warning")}</option>
              <option value="urgent">{t("common.urgent")}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400" htmlFor="announcementContent">{t("announcementsPage.edit.content")}</label>
            <textarea
              id="announcementContent"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              data-input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              className="rounded-lg border-white/20"
            />
            {t("common.pinned")}
          </label>
        </div>

        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-400 transition hover:bg-white/5"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim() || !content.trim()}
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:opacity-40"
          >
            {saving ? t("announcementsPage.edit.saving") : t("announcementsPage.edit.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
