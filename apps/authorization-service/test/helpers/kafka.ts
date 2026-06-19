/**
 * Kafka test helpers — real kafkajs wrappers.
 * These are TEST INFRASTRUCTURE (not the system under test), so direct kafkajs
 * use is intentional and correct here.
 *
 * All hosts/ports read from env vars — no hardcoded literals.
 */
import { Kafka, Producer, Consumer, EachMessagePayload } from 'kafkajs';
import { AuthorizationRequestDto } from '@open-supervisor/shared-types';
import { AuthorizationResponseDto } from '@open-supervisor/shared-types';

function buildKafka(): Kafka {
  const brokers = (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(',');
  return new Kafka({
    clientId: 'e2e-test-client',
    brokers,
    logLevel: 0,
  });
}

/**
 * Delete all records from a Kafka topic (up to the latest offset).
 * Uses admin API to truncate the topic so subsequent consumers don't
 * have to process stale data from previous test runs.
 */
export async function clearTopic(topic: string): Promise<void> {
  const kafka = buildKafka();
  const admin = kafka.admin();
  await admin.connect();
  try {
    const offsets = await admin.fetchTopicOffsets(topic);
    const partitions = offsets.map((o) => ({
      partition: o.partition,
      offset: o.offset,
    }));
    // Only delete if there are records
    if (partitions.length > 0 && partitions.some((p) => parseInt(p.offset, 10) > 0)) {
      await admin.deleteTopicRecords({ topic, partitions });
    }
  } finally {
    await admin.disconnect();
  }
}

/**
 * Publishes an AuthorizationRequestDto to the `auth.requests` topic.
 * Creates and immediately disconnects the producer (low-frequency test usage).
 */
export async function publishRequest(dto: AuthorizationRequestDto): Promise<void> {
  const kafka = buildKafka();
  const producer: Producer = kafka.producer();
  await producer.connect();
  try {
    await producer.send({
      topic: 'auth.requests',
      messages: [
        {
          key: dto.correlation_id,
          value: JSON.stringify(dto),
        },
      ],
    });
  } finally {
    await producer.disconnect();
  }
}

/**
 * Polls Kafka topic `auth.response.${storeId}` until a message whose parsed
 * body contains the given `correlationId` (field `correlation_id`) arrives,
 * or `timeoutMs` elapses.
 *
 * Resolves with the parsed AuthorizationResponseDto.
 * Rejects with an error containing "Timeout" on timeout.
 *
 * Uses a fresh consumer group per invocation (unique suffix) so concurrent
 * test calls don't interfere.
 */
export async function awaitResponse(
  storeId: string,
  correlationId: string,
  _timeoutMs: number,
): Promise<AuthorizationResponseDto> {
  const kafka = buildKafka();
  const groupId = `e2e-response-consumer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const consumer: Consumer = kafka.consumer({ groupId });
  const topic = `auth.response.${storeId}`;

  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });

  return new Promise<AuthorizationResponseDto>((resolve, reject) => {
    let settled = false;

    consumer
      .run({
        eachMessage: async ({ message }: EachMessagePayload) => {
          if (settled) return;
          if (!message.value) return;

          let parsed: unknown;
          try {
            parsed = JSON.parse(message.value.toString());
          } catch {
            return;
          }

          const receivedId = (parsed as Record<string, unknown>)['correlation_id'];
          if (receivedId !== correlationId) {
            return;
          }

          settled = true;
          await consumer.disconnect();
          resolve(parsed as AuthorizationResponseDto);
        },
      })
      .catch((err: Error) => {
        if (!settled) {
          settled = true;
          consumer.disconnect().catch(() => {});
          reject(err);
        }
      });
  });
}
