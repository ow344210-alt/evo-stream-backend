-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "hlsMasterKey" TEXT,
ADD COLUMN     "posterThumbnailKey" TEXT,
ADD COLUMN     "processError" TEXT;

-- CreateTable
CREATE TABLE "VideoRendition" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "bitrateKbps" INTEGER,
    "height" INTEGER,
    "width" INTEGER,
    "codec" TEXT,
    "storageProvider" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "playlistKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoRendition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoThumbnail" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'poster',
    "storageProvider" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoThumbnail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoRendition_videoId_idx" ON "VideoRendition"("videoId");

-- CreateIndex
CREATE INDEX "VideoThumbnail_videoId_idx" ON "VideoThumbnail"("videoId");

-- AddForeignKey
ALTER TABLE "VideoRendition" ADD CONSTRAINT "VideoRendition_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoThumbnail" ADD CONSTRAINT "VideoThumbnail_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
