import 'reflect-metadata';
import './common/bigint';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { S3Storage } from './infra/storage';
import { config } from './config';
import { log } from './common/http';

export async function createApp() {
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: false });
  app.use(cookieParser());
  app.enableCors({ origin: config.webOrigin, credentials: true });
  (app as any).set('trust proxy', 1);
  return app;
}

async function bootstrap() {
  const app = await createApp();
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Oja Market API').setVersion('0.1.0').addBearerAuth().build());
  SwaggerModule.setup('docs', app, doc);
  await new S3Storage().ensureBuckets().catch((e) => log.warn({ err: e.message }, 'storage not ready'));
  await app.listen(config.port, '0.0.0.0');
  log.info({ port: config.port }, 'api listening');
}
process.on('unhandledRejection', (e) => log.error({ err: e }, 'unhandledRejection'));
process.on('uncaughtException', (e) => { log.fatal({ err: e }, 'uncaughtException'); process.exit(1); });
if (require.main === module) bootstrap().catch((e) => { log.fatal({ err: e }, 'startup failed'); process.exit(1); });
