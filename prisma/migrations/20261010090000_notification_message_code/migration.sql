-- Locale-independent notification copy: rows keep the rendered fallback text
-- and add an event code plus parameters rendered in the viewer's language.
ALTER TABLE "notifications"
  ADD COLUMN "messageCode" TEXT,
  ADD COLUMN "messageParams" JSONB;
