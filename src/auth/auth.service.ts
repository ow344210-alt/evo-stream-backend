import {
  ConflictException,
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { EmailService } from './email/email.service';
import { RegisterAccountType } from './types/register-account-type';
import { JwtPayload } from './types/jwt-payload.type';
import { AuthenticatedUser } from './types/authenticated-user.type';

const BCRYPT_ROUNDS = 12;

export interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthResult {
  user: SafeUser;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  /**
   * DEVELOPMENT-ONLY helper. Logs the freshly generated verification code to the
   * backend terminal so it can be entered into the existing verification form
   * when real email delivery is not possible (e.g. no verified Resend domain).
   *
   * Strictly guarded by `NODE_ENV === 'production'` — in production this helper
   * is a no-op and the code is never logged or otherwise exposed.
   */
  private logDevVerificationCode(email: string, code: string): void {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      return;
    }
    this.logger.log(
      `[DEV EMAIL VERIFICATION]\nEmail: ${email}\nVerification Code: ${code}`,
    );
  }

  private safeUser(user: User): SafeUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private signAccessToken(user: { id: string; email: string; role: UserRole }): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn:
        (this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m') as JwtSignOptions['expiresIn'],
    });
  }

  private generateRefreshToken(): string {
    return crypto.randomBytes(48).toString('base64url');
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private generateEmailCode(): string {
    let code = '';
    const randomBytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) {
      code += String(randomBytes[i] % 10);
    }
    return code;
  }

  private generateResetToken(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private async createRefreshSession(userId: string): Promise<string> {
    const refreshToken = this.generateRefreshToken();
    const expiresAt = new Date(
      Date.now() + this.parseExpiry(this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d'),
    );
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
      },
    });
    return refreshToken;
  }

  private parseExpiry(expiry: string): number {
    const match = /^(\d+)([smhd])$/.exec(expiry.trim());
    if (!match) {
      return 7 * 24 * 60 * 60 * 1000;
    }
    const value = parseInt(match[1], 10);
    switch (match[2]) {
      case 's':
        return value * 1000;
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      default:
        return 7 * 24 * 60 * 60 * 1000;
    }
  }

  async register(dto: RegisterDto): Promise<{ user: SafeUser; verificationCode: string | null }> {
    const email = this.normalizeEmail(dto.email);
    const allowedType = dto.accountType ?? RegisterAccountType.USER;

    const existing = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const role = allowedType === RegisterAccountType.CREATOR ? UserRole.CREATOR : UserRole.USER;

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        name: dto.name.trim(),
        role,
      },
    });

    if (role === UserRole.CREATOR) {
      await this.prisma.creatorProfile.create({
        data: { userId: user.id },
      });
    }

    const code = this.generateEmailCode();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await this.prisma.emailVerification.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(code),
        expiresAt,
      },
    });

    // Always attempt normal Resend delivery (no-op in dev when unconfigured).
    await this.email.send({
      to: user.email,
      subject: 'Verify your EVO email address',
      html: `<p>Your EVO verification code is: <strong>${code}</strong></p><p>It expires in 1 hour.</p>`,
    });

    // DEVELOPMENT ONLY: surface the code in the backend terminal for local
    // testing. Never returned in the API response, never exposed to the client.
    this.logDevVerificationCode(user.email, code);

    return { user: this.safeUser(user), verificationCode: null };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('This account has been suspended');
    }

    if (!user.emailVerified) {
      throw new ForbiddenException('Please verify your email address before signing in');
    }

    const accessToken = this.signAccessToken(user);
    const refreshToken = await this.createRefreshSession(user.id);

    return { user: this.safeUser(user), accessToken, refreshToken };
  }

  async refresh(dto: RefreshDto): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = this.hashToken(dto.refreshToken);
    const session = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = session.user;
    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('This account has been suspended');
    }

    // Rotate: revoke the old session and issue a new one
    await this.prisma.refreshToken.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const accessToken = this.signAccessToken(user);
    const refreshToken = await this.createRefreshSession(user.id);

    return { accessToken, refreshToken };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<{ message: string; emailVerified: boolean }> {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new BadRequestException('Invalid verification details');
    }

    if (user.emailVerified) {
      return { message: 'Email already verified', emailVerified: true };
    }

    const tokenHash = this.hashToken(dto.code.trim());
    const record = await this.prisma.emailVerification.findFirst({
      where: { userId: user.id, tokenHash, usedAt: null },
    });

    if (!record) {
      throw new BadRequestException('Invalid verification code');
    }
    if (record.expiresAt < new Date()) {
      throw new BadRequestException('Verification code has expired');
    }

    await this.prisma.$transaction([
      this.prisma.emailVerification.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      }),
    ]);

    return { message: 'Email verified successfully', emailVerified: true };
  }

  async resendVerification(dto: ResendVerificationDto): Promise<{ message: string; verificationCode: string | null }> {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Avoid user enumeration; respond generically
      return { message: 'If the account exists, a verification email was sent', verificationCode: null };
    }
    if (user.emailVerified) {
      return { message: 'Email already verified', verificationCode: null };
    }

    const code = this.generateEmailCode();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await this.prisma.emailVerification.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(code),
        expiresAt,
      },
    });

    // Attempt normal Resend delivery.
    await this.email.send({
      to: user.email,
      subject: 'Verify your EVO email address',
      html: `<p>Your EVO verification code is: <strong>${code}</strong></p>`,
    });

    // DEVELOPMENT ONLY: surface the NEW code to the backend terminal. The
    // previous code remains invalid per the existing used/expiry invalidation.
    this.logDevVerificationCode(user.email, code);

    return { message: 'If the account exists, a verification email was sent', verificationCode: null };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Always respond with the same message to avoid enumeration, and never
    // authenticate the user through this endpoint.
    if (!user) {
      return { message: 'If an account with that email exists, a reset link has been sent' };
    }

    const token = this.generateResetToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(token),
        expiresAt,
      },
    });

    await this.email.send({
      to: user.email,
      subject: 'Reset your EVO password',
      html: `<p>Use the following link to reset your password:</p><p><a href="${this.config.get<string>('FRONTEND_URL')}/creator/auth?mode=reset&token=${token}">Reset password</a></p><p>This link expires in 1 hour.</p>`,
    });

    return { message: 'If an account with that email exists, a reset link has been sent' };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const tokenHash = this.hashToken(dto.token);
    const record = await this.prisma.passwordReset.findUnique({
      where: { tokenHash },
    });
    if (!record) {
      throw new BadRequestException('Invalid or expired reset token');
    }
    if (record.usedAt) {
      throw new BadRequestException('This reset token has already been used');
    }
    if (record.expiresAt < new Date()) {
      throw new BadRequestException('This reset token has expired');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.passwordReset.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      // Revoke any existing refresh sessions
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { message: 'Password has been reset successfully' };
  }

  /**
   * Returns the authenticated user's public profile.
   *
   * The user was already fetched and validated by the JwtStrategy (existence +
   * not-suspended) on this request, so we build the response from that object
   * instead of issuing a redundant database lookup on every `/auth/me`.
   */
  me(user: AuthenticatedUser): SafeUser {
    return this.safeUser({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    } as unknown as User);
  }
}
