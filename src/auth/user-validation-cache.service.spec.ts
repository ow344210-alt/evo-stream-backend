import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole, UserStatus } from '@prisma/client';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UserValidationCacheService } from './user-validation-cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from './types/authenticated-user.type';
import { JwtPayload } from './types/jwt-payload.type';

function makeAuthUser(id: string, overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id,
    email: `${id}@example.com`,
    role: UserRole.USER,
    name: 'User',
    status: UserStatus.ACTIVE,
    emailVerified: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

const configService = {
  get: (key: string) => (key === 'JWT_ACCESS_SECRET' ? 'test-secret' : ''),
} as unknown as ConfigService;

const payload: JwtPayload = {
  sub: 'user-1',
  email: 'user-1@example.com',
  role: UserRole.USER,
};

describe('UserValidationCacheService (JWT DB amplification fix)', () => {
  let strategy: JwtStrategy;
  let cache: UserValidationCacheService;
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    cache = UserValidationCacheService.create();
    strategy = new JwtStrategy(configService, prisma as unknown as PrismaService, cache);
  });

  it('1. first validation performs a DB lookup', async () => {
    prisma.user.findUnique.mockResolvedValue(makeAuthUser('user-1'));
    const result = await strategy.validate(payload);
    expect(result.id).toBe('user-1');
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('2. repeated validation for the same user within TTL does NOT hit the DB again', async () => {
    prisma.user.findUnique.mockResolvedValue(makeAuthUser('user-1'));
    await strategy.validate(payload);
    await strategy.validate(payload);
    await strategy.validate(payload);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('3. a different user triggers its own lookup', async () => {
    prisma.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'user-1' ? makeAuthUser('user-1') : makeAuthUser('user-2'),
    );
    await strategy.validate(payload);
    await strategy.validate({ ...payload, sub: 'user-2' });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('4. an expired cache entry causes the DB to be queried again', async () => {
    jest.useFakeTimers();
    try {
      prisma.user.findUnique.mockResolvedValue(makeAuthUser('user-1'));
      await strategy.validate(payload);
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(31_000);
      await strategy.validate(payload);
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('5. a missing user is rejected exactly as before and is never cached', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
    // Not cached as valid: the next request queries the DB again and is rejected again.
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('6. a suspended user is rejected exactly as before and is never cached', async () => {
    prisma.user.findUnique.mockResolvedValue(
      makeAuthUser('user-1', { status: UserStatus.SUSPENDED }),
    );
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('7. invalidateUser forces a fresh DB lookup on the next request', async () => {
    prisma.user.findUnique.mockResolvedValue(makeAuthUser('user-1'));
    await strategy.validate(payload);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);

    cache.invalidateUser('user-1');
    await strategy.validate(payload);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('8. concurrent validations for the same user share a single DB lookup', async () => {
    prisma.user.findUnique.mockResolvedValue(makeAuthUser('user-1'));
    const results = await Promise.all([
      strategy.validate(payload),
      strategy.validate(payload),
      strategy.validate(payload),
      strategy.validate(payload),
      strategy.validate(payload),
    ]);
    expect(results.map((r) => r.id)).toEqual(['user-1', 'user-1', 'user-1', 'user-1', 'user-1']);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('9a. a DB failure is not cached as a successful state', async () => {
    prisma.user.findUnique.mockRejectedValueOnce(new Error('connection pool timeout'));
    await expect(strategy.validate(payload)).rejects.toThrow('connection pool timeout');

    // Not cached: after the transient failure the next request re-queries and succeeds.
    prisma.user.findUnique.mockResolvedValueOnce(makeAuthUser('user-1'));
    await expect(strategy.validate(payload)).resolves.toMatchObject({ id: 'user-1' });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('9b. a rejected in-flight lookup is cleared so later requests retry', async () => {
    prisma.user.findUnique.mockRejectedValueOnce(new Error('db down'));
    const settled = await Promise.allSettled([
      strategy.validate(payload),
      strategy.validate(payload),
    ]);
    expect(settled.every((r) => r.status === 'rejected')).toBe(true);

    prisma.user.findUnique.mockResolvedValueOnce(makeAuthUser('user-1'));
    await expect(strategy.validate(payload)).resolves.toMatchObject({ id: 'user-1' });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('10. validated user keeps role/status intact for RBAC (no regression)', async () => {
    prisma.user.findUnique.mockResolvedValue(
      makeAuthUser('user-1', { role: UserRole.ADMIN }),
    );
    const result = await strategy.validate(payload);
    expect(result.role).toBe(UserRole.ADMIN);
    expect(result.status).toBe(UserStatus.ACTIVE);
  });

  it('PERF: N repeated validations within TTL produce exactly one Prisma user.findUnique call', async () => {
    prisma.user.findUnique.mockResolvedValue(makeAuthUser('user-1'));
    const N = 50;
    for (let i = 0; i < N; i += 1) {
      await strategy.validate(payload);
    }
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('UserValidationCacheService (bounded cache)', () => {
  it('evicts the oldest entries when the maximum size is reached', () => {
    const small = UserValidationCacheService.create(60_000, 2);
    small.set('a', makeAuthUser('a'));
    small.set('b', makeAuthUser('b'));
    small.set('c', makeAuthUser('c'));
    expect(small.size).toBe(2);
    expect(small.get('a')).toBeUndefined();
    expect(small.get('c')).toBeDefined();
  });

  it('never allows the cache to exceed the configured maximum (evicts expired first)', () => {
    jest.useFakeTimers();
    try {
      const small = UserValidationCacheService.create(60_000, 2);
      small.set('expired', makeAuthUser('expired'));
      jest.advanceTimersByTime(61_000);
      small.set('b', makeAuthUser('b'));
      small.set('c', makeAuthUser('c'));
      small.set('d', makeAuthUser('d'));
      expect(small.size).toBe(2);
      // expired entry was dropped during eviction, not counted against the cap
      expect(small.get('expired')).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('clamps a non-positive maximum to at least one entry', () => {
    const cache = UserValidationCacheService.create(60_000, 0);
    cache.set('a', makeAuthUser('a'));
    cache.set('b', makeAuthUser('b'));
    expect(cache.size).toBe(1);
  });

  it('clear() drops all entries', () => {
    const cache = UserValidationCacheService.create(60_000, 10);
    cache.set('a', makeAuthUser('a'));
    cache.set('b', makeAuthUser('b'));
    cache.clear();
    expect(cache.size).toBe(0);
  });
});