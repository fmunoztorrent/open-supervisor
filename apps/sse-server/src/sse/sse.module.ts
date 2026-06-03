import { Module } from '@nestjs/common';
import { NOTIFICATION_SUBSCRIBER } from '@open-supervisor/shared-messaging';
import { SseController } from './sse.controller';
import { SseService } from './sse.service';
import { RedisNotificationSubscriberAdapter } from '../infrastructure/redis-notification-subscriber.adapter';

@Module({
  controllers: [SseController],
  providers: [
    SseService,
    { provide: NOTIFICATION_SUBSCRIBER, useClass: RedisNotificationSubscriberAdapter },
  ],
})
export class SseModule {}
