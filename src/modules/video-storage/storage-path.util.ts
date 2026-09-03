import path from 'path';

/**
 * Path/identifier safety helpers shared by storage providers.
 *
 * The guiding rule: never trust a raw client filename or arbitrary input as a
 * filesystem path. Client-supplied names/ids are treated as untrusted data and
 * are normalised into provider-safe object keys before any filesystem access.
 */

const SEP = path.sep;
const HANDLED_SEPARATORS = /[\\/]+/g;
const UNSAFE_PATH_CHARS = /[^a-zA-Z0-9._-]/g;

/**
 * Normalise an untrusted logical segment (e.g. a client filename) into a safe
 * name containing only alphanumerics, `.`, `-` and `_`. Empty results fall
 * back to a stable placeholder token.
 */
export function sanitiseObjectSegment(value: string | undefined | null, fallback: string): string {
  const raw = (value ?? '').trim();
  const cleaned = raw.replace(HANDLED_SEPARATORS, '-').replace(UNSAFE_PATH_CHARS, '-');
  return cleaned || fallback;
}

/**
 * Build a provider-safe, whitespace-normalised object key from a logical
 * object path. Any `..` traversal segments are rejected outright rather than
 * silently collapsed.
 */
export function buildSafeObjectKey(objectPath: string): string {
  if (!objectPath || !objectPath.trim()) {
    throw new Error('A storage object key cannot be empty');
  }

  const segments = objectPath
    .split(HANDLED_SEPARATORS)
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0);

  for (const seg of segments) {
    if (seg === '.' || seg === '..') {
      throw new Error('Storage object key must not contain traversal segments (e.g. "..")');
    }
  }

  if (segments.length === 0) {
    throw new Error('A storage object key cannot be empty');
  }

  return segments.join('/');
}

/**
 * Resolve a safe relative object key to an absolute path guaranteed to stay
 * inside `rootDir`. Throws when the resulting path would escape the root (path
 * traversal protection), even if a crafted key slips past other filters.
 */
export function resolveWithin(rootDir: string, safeKey: string): string {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, safeKey);
  if (resolved !== root && !resolved.startsWith(root + SEP)) {
    throw new Error('Storage path escapes the configured storage root');
  }
  return resolved;
}

/** Apply separator awareness when a key may contain a mix of `/` and `\`. */
export function normaliseKeySeparators(key: string): string {
  return key.split(HANDLED_SEPARATORS).filter(Boolean).join('/');
}