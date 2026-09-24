/**
 * Phase-2 processing hardening constants shared by the queue and the
 * processing service. Keep this small and central so the recovery semantics
 * (stale threshold) and the bounded concurrency are defined in exactly one
 * place.
 */

/**
 * Global cap on videos being transcoded at once inside the API process. Each
 * job spawns up to 6 FFmpeg/Ffprobe child processes, so this stays small: 2
 * concurrent jobs keeps the phase-2 deployment (API + FFmpeg in one process)
 * responsive while still draining several uploads in parallel.
 */
export const MAX_CONCURRENT_PROCESSING = 2;

/**
 * A row left in PROCESSING for longer than this is considered abandoned (crash,
 * hung request, or a FAILED mark that could not be persisted). Rows younger
 * than this are treated as actively transcribing and are never touched.
 */
export const STALE_PROCESSING_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Delay before the boot sweep queries the database, giving Prisma time to (re-)
 * establish connectivity after a deployment/restart.
 */
export const STARTUP_SWEEP_DELAY_MS = 2 * 1000;