import { Module } from '@nestjs/common';
import { NOTIFICATION_SUBSCRIBER, LOGGER } from '@open-supervisor/shared-messaging';
import { SseController } from './sse.controller';
import { SseService } from './sse.service';
import { RedisNotificationSubscriberAdapter } from '../infrastructure/redis-notification-subscriber.adapter';
import { PinoLoggerAdapter } from '../infrastructure/logging/pino-logger.adapter';

@Module({
  controllers: [SseController],
  providers: [
    SseService,
    { provide: NOTIFICATION_SUBSCRIBER, useClass: RedisNotificationSubscriberAdapter },
    { provide: LOGGER, useFactory: () => new PinoLoggerAdapter('sse-server') },
  ],
})
export class SseModule {}
