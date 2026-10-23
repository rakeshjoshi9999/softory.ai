import 'reflect-metadata';
import { startTelemetry } from './telemetry';
import { loadConfig } from './config/config';

async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);
  await startTelemetry(config);
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./app.module');
  const app = await NestFactory.create(AppModule);
  await app.listen(config.port);
}

void bootstrap();
