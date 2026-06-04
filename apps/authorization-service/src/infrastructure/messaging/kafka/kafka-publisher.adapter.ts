import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';
import { IMessagePublisher } from '@open-supervisor/shared-messaging';

@Injectable()
export class KafkaPublisherAdapter implements IMessagePublisher, OnModuleDestroy {
  private readonly logger = new Logger(KafkaPublisherAdapter.name);
  private producer: Producer;

  constructor(private readonly config: ConfigService) {
    const kafka = new Kafka({
      clientId: config.get<string>('KAFKA_CLIENT_ID', 'authorization-service'),
      brokers: config.get<string>('KAFKA_BROKERS', 'localhost:9092').split(','),
    });
    this.producer = kafka.producer();
  }

  async onModuleInit(): Promise<void> {
    await this.producer.connect();
    this.logger.log('Kafka producer connected');
  }

  async publish(topic: string, message: unknown): Promise<void> {
    try {
      await this.producer.send({
        topic,
        messages: [{ value: JSON.stringify(message) }],
      });
      this.logger.debug(`Published to ${topic}`);
    } catch (error) {
      this.logger.error(
        `Failed to publish to Kafka topic ${topic}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new Error(
        `Kafka publish failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }
}
