import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * Global exception filter.
 *
 * HTTP exceptions (including controller-thrown bad requests, 401/403 from the
 * auth/roles guards, and ValidationPipe errors) pass through untouched.
 * Any other runtime error is converted to a generic message so internal
 * details (database, stack traces, etc.) are never leaked to clients.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      let message: unknown = 'An error occurred';
      if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const body = exceptionResponse as Record<string, unknown>;
        message = body.message ?? exception.message;
      } else if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      }

      response.status(status).json({
        statusCode: status,
        message,
        ...(Array.isArray(message) ? {} : { error: exception.name }),
      });
      return;
    }

    // Unknown/unexpected error - never leak internals.
    this.logger.error('Unhandled exception', exception as Error);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
