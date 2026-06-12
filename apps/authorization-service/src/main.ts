// Side-effect import: auto-initializes OpenTelemetry BEFORE NestJS bootstrap
import './infrastructure/logging/otel-sdk';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`authorization-service running on port ${port}`);
}

void bootstrap();
