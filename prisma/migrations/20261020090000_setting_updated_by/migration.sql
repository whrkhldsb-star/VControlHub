-- Who wrote each setting's current value (null: system or before this column).
ALTER TABLE "settings" ADD COLUMN "updatedBy" TEXT;
