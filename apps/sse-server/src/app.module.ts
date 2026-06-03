import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SseModule } from './sse/sse.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SseModule,
  ],
})
export class AppModule {}
