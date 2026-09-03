import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Optional authentication guard.
 *
 * Unlike the global JwtAuthGuard, this guard never rejects anonymous requests:
 * it resolves the user from a valid Bearer token when one is present and
 * otherwise returns `undefined`. Route handlers should accept an optional user
 * (e.g. `@CurrentUser('id') userId?: string`) and behave accordingly.
 *
 * Used on the social-summary endpoint so a video page is publicly readable
 * while still revealing the current viewer's personal state when authenticated.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = any>(
    err: unknown,
    user: TUser | null,
  ): TUser | undefined {
    // Propagate hard errors (e.g. corrupt token) but never require auth.
    if (err) {
      throw err;
    }
    return user ?? undefined;
  }
}
