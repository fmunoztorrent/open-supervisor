import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { INotificationSubscriber } from '@open-supervisor/shared-messaging';

@Injectable()
export class RedisNotificationSubscriberAdapter
  implements INotificationSubscriber, OnModuleDestroy
{
  private readonly logger = new Logger(RedisNotificationSubscriberAdapter.name);
  private readonly subscriber: Redis;

  constructor(private readonly config: ConfigService) {
    this.subscriber = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
    });

    this.subscriber.on('connect', () => this.logger.log('Redis subscriber connected'));
    this.subscriber.on('error', (err) => this.logger.error('Redis subscriber error', err));
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch, msg) => {
      if (ch === channel) handler(msg);
    });
    this.logger.log(`Subscribed to Redis channel: ${channel}`);
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.subscriber.unsubscribe(channel);
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber.quit();
  }
}
