# P0 — Bunny Durable Video Storage Implementation

Date: 2026-09-09
Scope: implement the missing durable Bunny video-storage provider for the Phase 2
pipeline behind the existing `VideoStorageProvider` abstraction, keep `local`
fully working, add mocked tests, do NOT change the database schema, and leave
all real Bunny verification pending (no credentials available).

Baseline audit: `D:\Evo-Platform-main\PHASE2_VIDEO_STORAGE_CURRENT_STATE_AUDIT.md`
(classification C — durable storage NOT implemented, local-only).

## What was implemented

1. `VideoStorageProvider` interface extended minimally (`video-storage.types.ts`)
   with three methods the durable pipeline needs:
   - `read(key)` — fetch stored bytes (used to download a cloud source before FFmpeg).
   - `deletePrefix(prefix)` — remove a whole object subtree (full video tree).
   - `getPublicUrl(key)` — absolute CDN URL when the provider serves objects over
     HTTPS (Bunny pull zone); `null` for local (caller falls back to `/api/media`).

2. New Bunny provider `bunny-video-storage.service.ts` — plain Node `fetch`
   against the Bunny Storage API (no SDK):
   - `store`: `PUT https://{storageHost}/{zone}/{key}` with `AccessKey`
     and an extension-derived `Content-Type`; returns provider-stable metadata.
   - `read` / `getObject` (`Range: bytes=0-0` + `Content-Range` size), `delete`,
     `deletePrefix` (folder DELETE; 404 is a defined no-op).
   - `getPublicUrl`: `https://{pullZone}/{key}`.
   - Security: keys normalised via `buildSafeObjectKey` (traversal rejected before
     any URL); the API key is only ever sent as a header and never logged or
     included in error messages.

3. `VideoStorageConfig`:
   - `provider=bunny` now requires the four Bunny variable NAMES
     (`BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_API_KEY`, `BUNNY_STORAGE_HOSTNAME`,
     `BUNNY_PULL_ZONE_HOSTNAME`); a missing variable produces an error listing
     only names, never values.
   - `provider=s3` still fails fast with "not yet implemented" (no partial adapter).
   - `provider=local` unchanged; no environment variables required.

4. `VideoStorageModule` factory resolves the bunny adapter when configured.

5. Processing layer (`video-processing.service.ts` + `local-video-transcoding.service.ts`):
   - Source object is read through the storage abstraction into a temporary local
     workspace when the provider is remote; FFmpeg runs unchanged.
   - After transcoding, the **complete HLS tree** (master playlist, per-rendition
     `index.m3u8`, every `segment_*.ts`, poster) is uploaded preserving the exact
     relative layout, so the relative references inside playlists resolve over the
     CDN. Durable anchors (master + poster) are verified via `getObject` before READY.
   - On publish failure the partial `videos/{videoId}/hls` + `.../thumbnails` are
     best-effort deleted and the video is marked FAILED.
   - Persisted `storageProvider` on `VideoRendition` / `VideoThumbnail` is the
     ACTIVE provider name (no more hardcoded `'local'`).
   - Temporary workspace is always removed (failure or success).

6. Playback (`video-playback.service.ts`) and feed (`public-feed.service.ts`):
   Bunny media URLs are absolute CDN URLs; local still returns `/api/media/...`.

7. Deletion (`videos.service.ts`): `removeOwn` now cleans the whole
   `videos/{videoId}` prefix (source + HLS tree + posters) through `deletePrefix`.

8. `.env.example` updated to the real Bunny variable names (documentation only;
   placeholder values, no secrets).

## Verification performed (automated only)

- Full backend suite: **32 suites / 336 tests passed** (`npm test`).
- Type check / build: **passed** (`npm run build`).
- Lint: **0 warnings / 0 errors** (`npm run lint`).
- New mocked coverage includes: upload success, playlist/nested key uploads,
  content-type mapping, CDN URL generation, non-2xx handling without secret
  leakage, missing-object no-op deletes, whole-prefix deletion, full-tree upload
  with provider-name persistence, publish-failure cleanup, local-provider
  compatibility, playback not depending on `/api/media` for bunny, config missing
  vars listing only names, s3 still unsupported, bunny config success.

## Real (non-mocked) verification

NOT performed — deferred to a later step when Bunny credentials are available.
Checklist for that step:
- Upload a real source with `VIDEO_STORAGE_PROVIDER=bunny` and confirm the full
  HLS tree appears in the storage zone.
- Confirm Bunny's directory `DELETE` behavior for `deletePrefix` (recursive removal
  vs per-file), and adjust if the folder endpoint leaves remnants.
- Confirm pull zone serves `videos/{id}/hls/master.m3u8` with correct relative
  segments to hls.js and expo-video.
- Confirm error/size/hostname validation against the real API.

## Status

- IMPLEMENTATION: COMPLETE (code + automated verification)
- LOCAL PROVIDER: WORKING, UNCHANGED (all local tests pass)
- BUNNY PROVIDER CODE: IMPLEMENTED (fetch-based, mocked tests pass)
- FULL HLS TREE DURABILITY: IMPLEMENTED (whole tree uploaded, anchors verified, partials cleaned)
- PLAYBACK URL WIRING: IMPLEMENTED (bunny → CDN URLs; local → /api/media fallback)
- DELETE-CLEANUP: IMPLEMENTED (deletePrefix `videos/{videoId}` for the active provider)
- DATABASE MIGRATION: NONE REQUIRED (schema already stores provider + keys)
- AUTOMATED TESTS: PASS (32 suites / 336 tests)
- BACKEND BUILD: PASS
- REAL BUNNY TEST: PENDING CREDENTIALS (deferred, required before production use)
- PRODUCTION VERIFICATION: NOT PERFORMED (requires real zone + pull zone)
- FILES CHANGED:
  - backend/src/modules/video-storage/video-storage.types.ts (interface extension)
  - backend/src/modules/video-storage/bunny-video-storage.service.ts (NEW provider)
  - backend/src/modules/video-storage/bunny-video-storage.service.spec.ts (NEW tests)
  - backend/src/modules/video-storage/local-video-storage.service.ts (read/deletePrefix/getPublicUrl)
  - backend/src/modules/video-storage/local-video-storage.service.spec.ts
  - backend/src/modules/video-storage/video-storage.config.ts (bunny validation)
  - backend/src/modules/video-storage/video-storage.config.spec.ts
  - backend/src/modules/video-storage/video-storage.module.ts (bunny factory)
  - backend/src/modules/video-processing/video-transcoding.types.ts (outputRoot hand-off)
  - backend/src/modules/video-processing/local-video-transcoding.service.ts (cloud source fetch + workspace)
  - backend/src/modules/video-processing/video-processing.service.ts (publish tree, provider name, cleanup)
  - backend/src/modules/video-processing/video-processing.service.spec.ts
  - backend/src/modules/video-playback/video-playback.service.ts (CDN URL resolution)
  - backend/src/modules/video-playback/video-playback.service.spec.ts
  - backend/src/modules/public-feed/public-feed.service.ts (poster CDN URL)
  - backend/src/modules/public-feed/public-feed.service.spec.ts
  - backend/src/modules/videos/videos.service.ts (deletePrefix cleanup)
  - backend/src/modules/videos/videos.service.spec.ts
  - backend/.env.example (Bunny variable names documented)
- REMAINING BLOCKERS: real Bunny credentials (zone, API key, hostname, pull zone) for live verification; confirm Bunny directory delete semantics; optional large-source streaming (source is currently read fully into memory for remote providers).