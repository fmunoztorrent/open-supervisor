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
  /**
   * Mapa de canales → handlers registrados. Un solo listener `message`
   * en el cliente ioredis despacha al handler del canal correspondiente.
   * Antes (bug): cada llamada a `subscribe()` agregaba un nuevo `on('message')`
   * listener que quedaba vivo para siempre, leak en uso prolongado.
   * Ver bugfix `e2e-outbox-fixes` (2026-06-04) — Bug 3.
   */
  private readonly handlers = new Map<string, (message: string) => void>();

  constructor(private readonly config: ConfigService) {
    this.subscriber = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
    });

    this.subscriber.on('connect', () => this.logger.log('Redis subscriber connected'));
    this.subscriber.on('error', (err) => this.logger.error('Redis subscriber error', err));

    // Único listener para todos los canales. Despacha al handler registrado.
    this.subscriber.on('message', (channel, message) => {
      const handler = this.handlers.get(channel);
      if (handler) {
        handler(message);
      }
    });
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    if (this.handlers.has(channel)) {
      this.logger.warn(
        `Channel ${channel} ya tenía un handler registrado; se reemplaza. ` +
        `Esto puede indicar un leak en el caller.`,
      );
    }
    this.handlers.set(channel, handler);
    if (this.subscriber.status !== 'ready' && this.subscriber.status !== 'connecting') {
      // No-op: ioredis encola los SUBSCRIBE si no está listo
    }
    await this.subscriber.subscribe(channel);
    this.logger.log(`Subscribed to Redis channel: ${channel}`);
  }

  async unsubscribe(channel: string): Promise<void> {
    this.handlers.delete(channel);
    await this.subscriber.unsubscribe(channel);
  }

  async onModuleDestroy(): Promise<void> {
    this.handlers.clear();
    await this.subscriber.quit();
  }
}
