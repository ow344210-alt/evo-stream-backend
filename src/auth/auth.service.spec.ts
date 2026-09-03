import { ConflictException, ForbiddenException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserRole, UserStatus } from '@prisma/client';
import { AuthService } from './auth.service';
import { RegisterAccountType } from './types/register-account-type';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email/email.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: Record<string, jest.Mock>;
    creatorProfile: Record<string, jest.Mock>;
    refreshToken: Record<string, jest.Mock>;
    emailVerification: Record<string, jest.Mock>;
    passwordReset: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };

  const mockUser = (overrides: Record<string, unknown> = {}) => ({
    id: 'user-1',
    email: 'creator@example.com',
    passwordHash: 'hashed-password',
    name: 'Test Creator',
    role: UserRole.CREATOR,
    status: UserStatus.ACTIVE,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const configService = {
    get: jest.fn((key: string) => {
const map: Record<string, string> = {
        NODE_ENV: 'test',
        JWT_ACCESS_SECRET: 'test-access-secret',
        JWT_REFRESH_SECRET: 'test-refresh-secret',
        JWT_ACCESS_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '7d',
        FRONTEND_URL: 'http://localhost:3000',
      };
      // Allow individual tests to override the environment (e.g. production).
      if (key === 'NODE_ENV' && (global as unknown as { __nodeEnv?: string }).__nodeEnv) {
        return (global as unknown as { __nodeEnv: string }).__nodeEnv;
      }
      return map[key];
    }),
  } as unknown as ConfigService;

  const jwtService = { sign: jest.fn(() => 'signed-jwt-token') } as unknown as JwtService;

  const makeEmail = () =>
    ({
      send: jest.fn().mockResolvedValue({ delivered: true, devMode: false }),
      isConfigured: true,
    } as unknown as EmailService);

  const makeService = (email: EmailService) =>
    new AuthService(
      prisma as unknown as PrismaService,
      jwtService,
      configService,
      email,
    );

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      creatorProfile: { create: jest.fn() },
      refreshToken: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      emailVerification: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      passwordReset: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    service = makeService(makeEmail());
  });

  describe('register', () => {
    it('1. creates a user and returns no plaintext password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }) =>
        mockUser({ email: data.email, role: data.role }),
      );

      const result = await service.register({
        name: 'Test Creator',
        email: '  Creator@Example.com ',
        password: 'Password123',
        accountType: RegisterAccountType.CREATOR,
      });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'creator@example.com', role: UserRole.CREATOR }),
        }),
      );
      expect(prisma.creatorProfile.create).toHaveBeenCalled();
      expect(JSON.stringify(result.user)).not.toContain('passwordHash');
      expect(JSON.stringify(result.user)).not.toContain('Password123');
    });

    it('3. stores a hashed password (never plaintext)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }) =>
        mockUser({ email: data.email, passwordHash: data.passwordHash }),
      );

      await service.register({
        name: 'Test Creator',
        email: 'creator@example.com',
        password: 'Password123',
        accountType: RegisterAccountType.CREATOR,
      });

      const createCall = prisma.user.create.mock.calls[0][0];
      expect(createCall.data.passwordHash).toBeDefined();
      expect(createCall.data.passwordHash).not.toBe('Password123');
      expect(createCall.data.passwordHash.startsWith('$2')).toBe(true);
    });

    it('2. rejects duplicate registration', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser());

      await expect(
        service.register({
          name: 'Test Creator',
          email: 'creator@example.com',
          password: 'Password123',
          accountType: RegisterAccountType.CREATOR,
        }),
      ).rejects.toBeInstanceOf(ConflictException);

expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('never returns the verification code in the API response', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }) =>
        mockUser({ email: data.email }),
      );

      const result = await service.register({
        name: 'Test Creator',
        email: 'creator@example.com',
        password: 'Password123',
        accountType: RegisterAccountType.CREATOR,
      });

      // The code must NOT leak through the API response in any environment.
      expect(result.verificationCode).toBeNull();
      expect(JSON.stringify(result)).not.toMatch(/\d{6}/);
    });

    it('does not log the verification code in production', async () => {
      (global as unknown as { __nodeEnv: string }).__nodeEnv = 'production';
      try {
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.user.create.mockImplementation(async ({ data }) =>
          mockUser({ email: data.email }),
        );

        const loggerSpy = jest
          .spyOn((service as unknown as { logger: { log: jest.Mock } }).logger, 'log')
          .mockImplementation(() => undefined);

        await service.register({
          name: 'Test Creator',
          email: 'creator@example.com',
          password: 'Password123',
          accountType: RegisterAccountType.CREATOR,
        });

        const logCalls = loggerSpy.mock.calls
          .map((c) => String(c[0]))
          .join('\n');
        expect(logCalls).not.toMatch(/[DEV EMAIL VERIFICATION]/);
        expect(logCalls).not.toMatch(/\d{6}/);

        loggerSpy.mockRestore();
      } finally {
        delete (global as unknown as { __nodeEnv?: string }).__nodeEnv;
      }
    });
  });

  describe('login', () => {
    let realHash: string;
    beforeAll(async () => {
      realHash = await bcrypt.hash('Password123', 10);
    });

    it('5. valid login succeeds and returns tokens + safe user', async () => {
      prisma.user.findUnique.mockResolvedValue(
        mockUser({ emailVerified: true, passwordHash: realHash }),
      );
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.login({ email: 'creator@example.com', password: 'Password123' });

      expect(result.accessToken).toBe('signed-jwt-token');
      expect(result.refreshToken).toBeDefined();
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('4. invalid password rejected', async () => {
      prisma.user.findUnique.mockResolvedValue(
        mockUser({ emailVerified: true, passwordHash: realHash }),
      );

      await expect(
        service.login({ email: 'creator@example.com', password: 'WrongPassword123!' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('4b. nonexistent user rejected without leaking existence', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.login({ email: 'ghost@invalid.com', password: 'WrongPassword123!' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('6. suspended user rejected', async () => {
      prisma.user.findUnique.mockResolvedValue(
        mockUser({ emailVerified: true, status: UserStatus.SUSPENDED, passwordHash: realHash }),
      );

      await expect(
        service.login({ email: 'creator@example.com', password: 'Password123' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('6b. unverified user prompts verification', async () => {
      prisma.user.findUnique.mockResolvedValue(
        mockUser({ emailVerified: false, passwordHash: realHash }),
      );

      await expect(
        service.login({ email: 'creator@example.com', password: 'Password123' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('verifyEmail', () => {
    it('7. invalid verification code rejected', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser());
      prisma.emailVerification.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyEmail({ email: 'creator@example.com', code: '999999' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('8. expired verification rejected', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser());
      prisma.emailVerification.findFirst.mockResolvedValue({
        id: 'ev-1',
        tokenHash: 'some-hash',
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
      });

      await expect(
        service.verifyEmail({ email: 'creator@example.com', code: '123456' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('8b. correct non-expired code verifies the user', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser());
      prisma.emailVerification.findFirst.mockResolvedValue({
        id: 'ev-1',
        tokenHash: 'some-hash',
        expiresAt: new Date(Date.now() + 10000),
        usedAt: null,
      });

      const result = await service.verifyEmail({ email: 'creator@example.com', code: '123456' });
      expect(result.emailVerified).toBe(true);
    });
  });

  describe('refresh token flow', () => {
    const session = (overrides: Record<string, unknown> = {}) => ({
      id: 'rt-1',
      tokenHash: 'hash',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 10000),
      user: mockUser({ emailVerified: true }),
      ...overrides,
    });

    it('13. valid refresh token issues new access token and rotates', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(session());
      prisma.refreshToken.update.mockResolvedValue({ revokedAt: new Date() });
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-2' });

      const result = await service.refresh({ refreshToken: 'valid-refresh-token' });
      expect(result.accessToken).toBe('signed-jwt-token');
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { revokedAt: expect.any(Date) } }),
      );
    });

    it('14. revoked refresh token rejected', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(session({ revokedAt: new Date() }));
      await expect(service.refresh({ refreshToken: 'revoked' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('14b. expired refresh token rejected', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(
        session({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.refresh({ refreshToken: 'expired' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('password reset', () => {
    it('15. forgot-password does not authenticate or return tokens', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser());
      prisma.passwordReset.create.mockResolvedValue({});

      const result = await service.forgotPassword({ email: 'creator@example.com' });
      expect(result).not.toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('refreshToken');
      expect(result).not.toHaveProperty('user');
    });

    it('15b. forgot-password for a nonexistent account returns a neutral message', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const result = await service.forgotPassword({ email: 'ghost@invalid.com' });
      expect(result.message).toContain('reset');
    });

    it('16. invalid reset token rejected', async () => {
      prisma.passwordReset.findUnique.mockResolvedValue(null);
      await expect(
        service.resetPassword({ token: 'bad-token', password: 'NewPassword123' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('17. expired reset token rejected', async () => {
      prisma.passwordReset.findUnique.mockResolvedValue({
        id: 'pr-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(
        service.resetPassword({ token: 'expired-token', password: 'NewPassword123' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('16b. already-used reset token rejected', async () => {
      prisma.passwordReset.findUnique.mockResolvedValue({
        id: 'pr-1',
        userId: 'user-1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 10000),
      });
      await expect(
        service.resetPassword({ token: 'used-token', password: 'NewPassword123' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('valid reset token updates password and revokes sessions', async () => {
      prisma.passwordReset.findUnique.mockResolvedValue({
        id: 'pr-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 10000),
      });
      prisma.user.update.mockResolvedValue(mockUser());
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.resetPassword({ token: 'valid-token', password: 'NewPassword123' });
      expect(result.message).toContain('reset');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    });
  });
});


