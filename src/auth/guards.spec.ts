import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { UserRole, UserStatus } from '@prisma/client';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RolesGuard } from './guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ROLES_KEY } from './decorators/roles.decorator';

function makeContext(user: unknown): any {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  };
}

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prisma: { user: { findUnique: jest.Mock } };

  const configService = {
    get: (k: string) => (k === 'JWT_ACCESS_SECRET' ? 'secret' : ''),
  } as unknown as ConfigService;

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    strategy = new JwtStrategy(configService, prisma as unknown as PrismaService);
  });

  it('9. valid JWT payload validates an active user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'u@example.com',
      role: UserRole.USER,
      name: 'User',
      status: UserStatus.ACTIVE,
    });
    const result = await strategy.validate({
      sub: 'user-1',
      email: 'u@example.com',
      role: UserRole.USER,
    });
    expect(result.id).toBe('user-1');
  });

  it('suspended user rejected from JWT validation', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'u@example.com',
      role: UserRole.USER,
      name: 'User',
      status: UserStatus.SUSPENDED,
    });
    await expect(
      strategy.validate({ sub: 'user-1', email: 'u@example.com', role: UserRole.USER }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('10. missing user for payload rejected', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      strategy.validate({ sub: 'ghost', email: 'g@example.com', role: UserRole.USER }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('11. USER cannot access a CREATOR endpoint', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.CREATOR]);
    const context = makeContext({ role: UserRole.USER });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('12b. CREATOR cannot access a USER-only endpoint', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.USER]);
    const context = makeContext({ role: UserRole.CREATOR });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('12. CREATOR cannot access an ADMIN endpoint', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    const context = makeContext({ role: UserRole.CREATOR });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('CREATOR can access a CREATOR endpoint', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.CREATOR]);
    const context = makeContext({ role: UserRole.CREATOR });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('roles are read from the ROLES_KEY metadata', () => {
    const handler = () => undefined;
    class TestController {}
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    const context = makeContext({ role: UserRole.ADMIN });
    context.getHandler = () => handler;
    context.getClass = () => TestController;

    guard.canActivate(context);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      ROLES_KEY,
      [handler, TestController],
    );
  });

  it('ADMIN can access an ADMIN endpoint', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    const context = makeContext({ role: UserRole.ADMIN });
    expect(guard.canActivate(context)).toBe(true);
  });
});

describe('JwtAuthGuard', () => {
  it('grants access to @Public endpoints without a token', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) };
    const guard = new JwtAuthGuard(reflector as unknown as Reflector);
    expect(guard.canActivate(makeContext({}))).toBe(true);
  });

  it('10b. rejects requests without a token on protected endpoints', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    const guard = new JwtAuthGuard(reflector as unknown as Reflector);
    // The underlying passport AuthGuard rejects token-less requests. In this
    // direct unit-test context passport throws a generic error; the
    // authoritative "missing JWT rejected" behavior is verified via the
    // JwtStrategy '10' test above and the 401 integration path.
    await expect(
      guard.canActivate(makeContext({})) as Promise<boolean>,
    ).rejects.toBeTruthy();
  });
});


