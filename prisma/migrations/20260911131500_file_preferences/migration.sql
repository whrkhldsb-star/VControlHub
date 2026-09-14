CREATE TABLE "file_preferences" (
  "userId" TEXT NOT NULL,
  "fileEntryId" TEXT NOT NULL,
  "favorite" BOOLEAN NOT NULL DEFAULT false,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "lastOpenedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "file_preferences_pkey" PRIMARY KEY ("userId", "fileEntryId"),
  CONSTRAINT "file_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "file_preferences_fileEntryId_fkey" FOREIGN KEY ("fileEntryId") REFERENCES "file_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "file_preferences_userId_favorite_updatedAt_idx" ON "file_preferences"("userId", "favorite", "updatedAt");
CREATE INDEX "file_preferences_userId_lastOpenedAt_idx" ON "file_preferences"("userId", "lastOpenedAt");
