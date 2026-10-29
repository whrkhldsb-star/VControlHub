-- file_preferences.fileEntryId references file_entries with ON DELETE CASCADE, but only its leading column
-- userId was indexed: deleting file entries scanned the whole table once per deleted row (2,000 rows took ~16 s).
CREATE INDEX "file_preferences_fileEntryId_idx" ON "file_preferences"("fileEntryId");
