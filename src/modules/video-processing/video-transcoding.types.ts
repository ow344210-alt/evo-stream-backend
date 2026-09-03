/**
 * P2-4 transcoding abstraction. The processing service depends on this
 * interface — never on a concrete transcoder — so swapping FFmpeg for a
 * cloud/GPU encoder is purely configuration driven (like the storage layer).
 */

/** One output bitrate ladder tier for HLS mastering. */
export interface TranscodeRenditionSpec {
  label: string; // e.g. "360p", "720p"
  videoBitrate: number; // bits per second (video track)
  audioBitrate: number; // bits per second (audio track)
  width?: number;
  height?: number;
  maxrate?: number;
  bufsize?: number;
}

/** Result of a single completed rendition: HLS variant m3u8 + segments dir. */
export interface TranscodeRenditionResult {
  label: string;
  height: number;
  width: number;
  bitrateKbps: number;
  codec: string;
  /** Provider-relative key where this rendition's segment files live. */
  segmentPrefix: string;
  /** Provider-relative key of the rendition .m3u8 playlist. */
  playlistKey: string;
}

/** A derived poster/thumbnail frame. */
export interface TranscodeThumbnailResult {
  key: string;
  kind: string;
  mimeType: string;
}

/** Full result of a successful transcode of one source video. */
export interface TranscodeResult {
  renditions: TranscodeRenditionResult[];
  thumbnails: TranscodeThumbnailResult[];
  /** Provider-relative key of the master HLS playlist. */
  masterPlaylistKey: string;
  durationSeconds: number;
}

/**
 * Configuration a provider needs to transcode a stored source object into HLS
 * renditions + a poster thumbnail.
 */
export interface TranscodeOptions {
  /** Provider-relative key of the stored source object. */
  sourceKey: string;
  /** Stable output prefix, e.g. `videos/{videoId}/hls`. */
  outputPrefix: string;
  /** Render banner/poster key prefix, e.g. `videos/{videoId}/thumbnails`. */
  thumbnailPrefix: string;
}

export const VIDEO_TRANSCODING_PROVIDER = Symbol('VIDEO_TRANSCODING_PROVIDER');

export interface VideoTranscodingProvider {
  readonly name: string;
  transcode(options: TranscodeOptions & {
    renditions: TranscodeRenditionSpec[];
    posterAtSeconds?: number;
  }): Promise<TranscodeResult>;
}