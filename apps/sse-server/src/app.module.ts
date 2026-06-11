import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SseModule } from './sse/sse.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SseModule,
    HealthModule,
  ],
})
export class AppModule {}
