-- CreateEnum
CREATE TYPE "VideoProcessingStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "processingStatus" "VideoProcessingStatus",
ADD COLUMN     "sourceFileSize" INTEGER,
ADD COLUMN     "sourceMimeType" TEXT,
ADD COLUMN     "sourceOriginalName" TEXT,
ADD COLUMN     "sourceStorageKey" TEXT,
ADD COLUMN     "sourceStorageProvider" TEXT;

-- CreateIndex
CREATE INDEX "Video_processingStatus_idx" ON "Video"("processingStatus");
