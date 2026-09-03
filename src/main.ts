import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';

/**
 * Build the environment-aware set of allowed CORS origins.
 *
 * Always allowed (explicit configuration):
 *  - `FRONTEND_URL` (single origin, backwards compatible)
 *  - `CORS_ORIGINS` (comma-separated list of extra origins)
 *
 * In non-production environments we additionally allow the well-known local
 * development origins so Expo Web (http://localhost:8081) and the Next.js web
 * app (http://localhost:3000) can reach the API during local QA, including
 * their 127.0.0.1 equivalents. Production never widens the allow-list beyond
 * the explicit FRONTEND_URL / CORS_ORIGINS configuration, so we never fall back
 * to an unrestricted `*` allow-all.
 */
function resolveAllowedOrigins(configService: ConfigService): string[] {
  const allowed = new Set<string>();

  const frontendUrl = configService.get<string>('FRONTEND_URL');
  if (frontendUrl) allowed.add(frontendUrl.trim().replace(/\/+$/, ''));

  const corsOrigins = configService.get<string>('CORS_ORIGINS');
  if (corsOrigins) {
    corsOrigins
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
      .forEach((origin) => allowed.add(origin.replace(/\/+$/, '')));
  }

  const nodeEnv = configService.get<string>('NODE_ENV');
  const isProduction = nodeEnv === 'production';
  if (!isProduction) {
    for (const origin of [
      'http://localhost:3000',
      'http://localhost:8081',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:8081',
    ]) {
      allowed.add(origin);
    }
  }

  return [...allowed];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

  app.setGlobalPrefix('api');

  app.enableCors({
    origin: resolveAllowedOrigins(configService),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  const port = configService.get<number>('PORT') ?? 4000;

  await app.listen(port);

  console.log(`EVO API running on http://localhost:${port}/api`);
}

bootstrap();