import 'reflect-metadata';

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { readRuntimeConfig } from './config/runtime-config';
import { earlyServerCorrelation } from './common/api-problem-boundary';

// Nothing else in this process loads apps/api/.env — do it before anything
// reads process.env (JWT_SECRET below, DATABASE_URL via Prisma, MinIO config).
// Path is relative to the compiled file (dist/main.js), not the cwd, so this
// works regardless of where the process was launched from.
const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

async function bootstrap(): Promise<void> {
  // AppModule contains modules that read process.env while they are evaluated.
  // Import it only after the env file is loaded and its contract is validated.
  const config = readRuntimeConfig();
  const { AppModule } = await import('./app.module');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, rawBody: true });
  app.getHttpAdapter().getInstance().set('trust proxy', config.trustProxyHops);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  // Must precede body parsers so malformed/oversized payload failures receive
  // the same server-owned correlation identity as routed Nest responses.
  app.use(earlyServerCorrelation);
  app.useBodyParser('json', { limit: '256kb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '64kb' });
  // Let Prisma's onModuleDestroy run on SIGINT/SIGTERM for a clean shutdown.
  app.enableShutdownHooks();

  // Parse/validate query + body DTOs; strip unknown props instead of crashing.
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableCors({
    origin: config.corsOrigins,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: config.identity.enabled,
    maxAge: 86_400,
  });

  if (config.appEnvironment !== 'production') {
    const openApiConfig = new DocumentBuilder()
      .setTitle('tyre.ge Admin API')
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth(config.identity.environment === 'production' ? '__Secure-tyre_admin_refresh' : 'tyre_admin_refresh')
      .build();
    const document = SwaggerModule.createDocument(app, openApiConfig);
    SwaggerModule.setup('openapi', app, document, { jsonDocumentUrl: 'openapi.json' });
  }

  await app.listen(config.port);

  new Logger('Bootstrap').log(
    `tyre.ge API listening on port ${config.port} (${config.appEnvironment}; readiness: GET /health/ready)`,
  );
}

// Last-resort safety nets: log with a stack trace instead of dying silently.
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  new Logger('UnhandledRejection').error(err.message, err.stack);
});

process.on('uncaughtException', (err) => {
  new Logger('UncaughtException').error(err.message, err.stack);
  // Node's default is to exit on uncaught exceptions; keep that behavior —
  // the process state is unknown, so a supervisor restart beats limping on.
  process.exit(1);
});

bootstrap().catch((err: Error) => {
  new Logger('Bootstrap').error(`Failed to start: ${err.message}`, err.stack);
  process.exit(1);
});
