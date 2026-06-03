import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { IEventEmitter } from '../../domain/ports/event-emitter.port';

@Injectable()
export class RedisPublisherAdapter implements IEventEmitter, OnModuleDestroy {
  private readonly logger = new Logger(RedisPublisherAdapter.name);
  private readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
    });

    this.client.on('connect', () => this.logger.log('Redis publisher connected'));
    this.client.on('error', (err) => this.logger.error('Redis publisher error', err));
  }

  async emit(channel: string, payload: unknown): Promise<void> {
    await this.client.publish(channel, JSON.stringify(payload));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
