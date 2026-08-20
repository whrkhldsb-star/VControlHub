-- One-way HMAC fingerprints of the single-use codes shown only when 2FA is enabled.
-- JSONB avoids a new join table while keeping the recovery set atomically replaceable.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "twoFactorRecoveryCodes" JSONB;
