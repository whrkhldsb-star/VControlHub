ALTER TABLE "servers" ADD COLUMN "rdpCertificateSha256" TEXT;
ALTER TABLE "servers" ADD CONSTRAINT "servers_rdp_certificate_pin_check" CHECK ("rdpCertificateSha256" IS NULL OR ("rdpCertificateSha256" ~ '^[0-9a-f]{64}$' AND "rdpIgnoreCertificate" = false));
