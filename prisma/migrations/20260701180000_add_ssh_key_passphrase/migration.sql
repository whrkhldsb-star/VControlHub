-- Add passphrase column to SshKey table
ALTER TABLE "SshKey" ADD COLUMN "passphrase" TEXT;
