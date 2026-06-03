import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer } from 'kafkajs';
import { IMessageConsumer } from '@open-supervisor/shared-messaging';

@Injectable()
export class KafkaConsumerAdapter implements IMessageConsumer, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerAdapter.name);
  private consumer: Consumer | null = null;
  private readonly kafka: Kafka;

  constructor(private readonly config: ConfigService) {
    this.kafka = new Kafka({
      clientId: config.get<string>('KAFKA_CLIENT_ID', 'authorization-service'),
      brokers: config.get<string>('KAFKA_BROKERS', 'localhost:9092').split(','),
    });
  }

  async subscribe(
    topics: string[],
    groupId: string,
    handler: (topic: string, message: unknown) => Promise<void>,
  ): Promise<void> {
    this.consumer = this.kafka.consumer({ groupId });
    await this.consumer.connect();

    for (const topic of topics) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
    }

    await this.consumer.run({
      eachMessage: async ({ topic, message }) => {
        if (!message.value) return;
        try {
          const payload = JSON.parse(message.value.toString()) as unknown;
          await handler(topic, payload);
        } catch (err) {
          this.logger.error(`Failed to process message from ${topic}`, err);
        }
      },
    });

    this.logger.log(`Subscribed to topics: ${topics.join(', ')} (group: ${groupId})`);
  }

  async disconnect(): Promise<void> {
    await this.consumer?.disconnect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }
}
