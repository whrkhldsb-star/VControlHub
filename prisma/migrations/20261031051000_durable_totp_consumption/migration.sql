-- Additive, nullable: existing users retain their current authentication state.
ALTER TABLE "User" ADD COLUMN "lastAcceptedTotpStep" INTEGER;
