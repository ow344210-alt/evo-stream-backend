import { Inject, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from './types/authenticated-user.type';

export const DEFAULT_TTL_MS = 'USER_CACHE_DEFAULT_TTL_MS';
export const DEFAULT_MAX_ENTRIES = 'USER_CACHE_DEFAULT_MAX_ENTRIES';

/**
 * Short-lived, bounded in-memory cache for JWT user validation.
 *
 * Background (P0-1): every authenticated request previously triggered a
 * `prisma.user.findUnique()` inside `JwtStrategy.validate`. Player/social
 * screens fire many authenticated requests in parallel, so the same row was
 * re-read repeatedly and each read held a pool connection against the remote
 * pooler. This cache collapses repeated validations for the same user into
 * one database lookup per TTL window.
 *
 * Safety properties:
 * - Only successfully validated users are cached (see `set` usage: the loader
 *   throws for missing/suspended users, so they are never cached as valid).
 * - TTL is short (30s default) and size is bounded (1000 entries default) so
 *   the maximum stale-authorization window stays small.
 * - Cleanup is lazy (on get/set) — no background timers.
 * - In-flight Promises are deduplicated per user id (single-flight): concurrent
 *   requests for the same uncached user share one database lookup, and the
 *   in-flight entry is removed in `finally` so a rejected lookup is never
 *   cached or reused.
 */
@Injectable()
export class UserValidationCacheService {
  static readonly FALLBACK_TTL_MS = 30_000;
  static readonly FALLBACK_MAX_ENTRIES = 1_000;

  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<AuthenticatedUser>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(
    @Inject(DEFAULT_TTL_MS) ttlMs: number,
    @Inject(DEFAULT_MAX_ENTRIES) maxEntries: number,
  ) {
    this.ttlMs = ttlMs;
    this.maxEntries = Math.max(1, maxEntries);
  }

  /** Build a default-configured instance without a Nest container (tests). */
  static create(
    ttlMs: number = UserValidationCacheService.FALLBACK_TTL_MS,
    maxEntries: number = UserValidationCacheService.FALLBACK_MAX_ENTRIES,
  ): UserValidationCacheService {
    return new UserValidationCacheService(ttlMs, maxEntries);
  }

  /**
   * Resolve the validated user for `userId`, hitting `loader` (the database)
   * only on a cache miss. Concurrent callers for the same uncached user share
   * the same in-flight lookup. The result is cached on success.
   */
  async loadUser(
    userId: string,
    loader: () => Promise<AuthenticatedUser>,
  ): Promise<AuthenticatedUser> {
    const cached = this.get(userId);
    if (cached) {
      return cached;
    }

    const existing = this.inFlight.get(userId);
    if (existing) {
      return existing;
    }

    // Normalise a synchronous throw from `loader` into a rejection so the
    // in-flight bookkeeping below is always reached.
    const pending = Promise.resolve().then(loader);
    this.inFlight.set(userId, pending);

    try {
      const user = await pending;
      this.set(userId, user);
      return user;
    } finally {
      if (this.inFlight.get(userId) === pending) {
        this.inFlight.delete(userId);
      }
    }
  }

  get(userId: string): AuthenticatedUser | undefined {
    const entry = this.entries.get(userId);
    if (!entry) {
      return undefined;
    }
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(userId);
      return undefined;
    }
    return entry.user;
  }

  set(userId: string, user: AuthenticatedUser): void {
    if (!this.entries.has(userId) && this.entries.size >= this.maxEntries) {
      this.evict();
    }
    this.entries.set(userId, {
      user,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /**
   * Drop the cached validation for a user so the next request re-reads the
   * database. Called by security-sensitive flows (role/status/password/email
   * changes). A user not present in the cache is a no-op.
   */
  invalidateUser(userId: string): void {
    this.entries.delete(userId);
  }

  /** Drop all entries (used by tests and on explicit reset). */
  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Bounded-size enforcer: discard expired entries first, then the oldest
   * remaining entries until the cache is back under the maximum.
   */
  private evict(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now >= entry.expiresAt) {
        this.entries.delete(key);
      }
    }
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) {
        break;
      }
      this.entries.delete(oldest.value);
    }
  }
}

interface CacheEntry {
  user: AuthenticatedUser;
  expiresAt: number;
}