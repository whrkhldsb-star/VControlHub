UPDATE "file_entries" SET "deleteBatchId" = 'legacy-' || id WHERE "isDeleted" AND "deleteBatchId" IS NULL;
