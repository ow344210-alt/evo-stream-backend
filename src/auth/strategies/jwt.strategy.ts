import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { performance } from 'node:perf_hooks';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UserValidationCacheService } from '../user-validation-cache.service';
import { JwtPayload } from '../types/jwt-payload.type';
import { AuthenticatedUser } from '../types/authenticated-user.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);
  private readonly profiling = process.env.NODE_ENV !== 'production';

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly userCache: UserValidationCacheService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET') ?? '',
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // Short-TTL cache + single-flight deduplication: repeated and concurrent
    // requests for the same user share one DB lookup instead of issuing a
    // `prisma.user.findUnique()` per request. Loading is deferred to the DB
    // again when the cached entry expires (default 30s) or is invalidated.
    return this.userCache.loadUser(payload.sub, () =>
      this.loadUserFromDb(payload),
    );
  }

  private async loadUserFromDb(payload: JwtPayload): Promise<AuthenticatedUser> {
    const startTotal = performance.now();

    let user: User | null;
    if (this.profiling) {
      const startQuery = performance.now();
      user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
      this.logger.log(
        `[AUTH PERF] Prisma user.findUnique: ${(performance.now() - startQuery).toFixed(2)} ms`,
      );
    } else {
      user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
    }

    if (!user || user.status === 'SUSPENDED') {
      throw new UnauthorizedException('Invalid or suspended account');
    }

    const result: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      status: user.status,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    if (this.profiling) {
      this.logger.log(
        `[AUTH PERF] JwtStrategy.validate total: ${(performance.now() - startTotal).toFixed(2)} ms`,
      );
    }

    return result;
  }
}