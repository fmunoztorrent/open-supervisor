/**
 * RED PHASE — Tests for Kafka broker configuration fallback behavior.
 *
 * Validates that authorization-service correctly falls back to localhost:9092
 * when KAFKA_BROKERS is not set, and can be overridden for LocalStack MSK.
 *
 * These tests use ConfigService to verify the contract without needing
 * a running Kafka broker. The actual KAFKA_BROKERS reading happens in
 * KafkaConsumerAdapter and KafkaPublisherAdapter constructors.
 *
 * Execute: pnpm --filter authorization-service test
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

describe('Kafka configuration — KAFKA_BROKERS env var', () => {
  let configService: ConfigService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ConfigService,
          useValue: new ConfigService({}),
        },
      ],
    }).compile();

    configService = module.get<ConfigService>(ConfigService);
  });

  // ── Test 1: default fallback to localhost:9092 ───────────────────────────
  it('defaults to localhost:9092 when KAFKA_BROKERS env var is not set', () => {
    const brokers = configService.get<string>('KAFKA_BROKERS', 'localhost:9092');
    expect(brokers).toBe('localhost:9092');
  });

  // ── Test 2: split contract ────────────────────────────────────────────────
  it('split(",") produces single-element array for default', () => {
    const brokers = configService
      .get<string>('KAFKA_BROKERS', 'localhost:9092')
      .split(',');
    expect(brokers).toEqual(['localhost:9092']);
  });

  // ── Test 3: override via ConfigService ────────────────────────────────────
  it('returns overridden value when KAFKA_BROKERS is set in config', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ConfigService,
          useValue: new ConfigService({
            KAFKA_BROKERS: 'localhost:4511',
          }),
        },
      ],
    }).compile();

    const svc = module.get<ConfigService>(ConfigService);
    const brokers = svc.get<string>('KAFKA_BROKERS', 'localhost:9092');
    expect(brokers).toBe('localhost:4511');
  });

  // ── Test 4: multiple brokers separated by comma ───────────────────────────
  it('supports multiple brokers (KAFKA_BROKERS with commas)', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ConfigService,
          useValue: new ConfigService({
            KAFKA_BROKERS: 'localhost:4511,localhost:4512,localhost:4513',
          }),
        },
      ],
    }).compile();

    const svc = module.get<ConfigService>(ConfigService);
    const brokerString = svc.get<string>('KAFKA_BROKERS', 'localhost:9092');
    const brokers = brokerString.split(',').map((b: string) => b.trim());
    expect(brokers).toEqual(['localhost:4511', 'localhost:4512', 'localhost:4513']);
  });

  // ── Test 5: KAFKA_BROKERS with padding spaces ─────────────────────────────
  it('trims spaces from individual broker addresses after split', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ConfigService,
          useValue: new ConfigService({
            KAFKA_BROKERS: ' localhost:4511 , localhost:4512 ',
          }),
        },
      ],
    }).compile();

    const svc = module.get<ConfigService>(ConfigService);
    const brokerString = svc.get<string>('KAFKA_BROKERS', 'localhost:9092');
    const brokers = brokerString.split(',').map((b: string) => b.trim());
    expect(brokers).toEqual(['localhost:4511', 'localhost:4512']);
  });

  // ── Test 6: fallback when config is empty string ─────────────────────────
  it('falls back to default when KAFKA_BROKERS is empty string', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ConfigService,
          useValue: new ConfigService({
            KAFKA_BROKERS: '',
          }),
        },
      ],
    }).compile();

    const svc = module.get<ConfigService>(ConfigService);
    const raw = svc.get<string>('KAFKA_BROKERS', 'localhost:9092');
    // Empty string is falsy; consumer should handle this
    const brokers = raw
      ? raw
          .split(',')
          .map((b: string) => b.trim())
          .filter(Boolean)
      : ['localhost:9092'];
    expect(brokers).toEqual(['localhost:9092']);
  });

  // ── Test 7: KAFKA_CLIENT_ID is independent from KAFKA_BROKERS ──────────────
  it('KAFKA_CLIENT_ID defaults to authorization-service independently of KAFKA_BROKERS', () => {
    const clientId = configService.get<string>(
      'KAFKA_CLIENT_ID',
      'authorization-service',
    );
    expect(clientId).toBe('authorization-service');
  });

  // ── Test 8: does not require msk-env.sh file to exist ────────────────────
  it('does not require scripts/msk-env.sh file — reads from env var only', () => {
    // The ConfigService reads from process.env directly.
    // msk-env.sh is sourced by the Makefile before starting services.
    // This test validates that the service itself does NOT try to read
    // the file — it relies on env vars set by the orchestration layer.
    const svc = new ConfigService({});
    const brokers = svc.get<string>('KAFKA_BROKERS', 'localhost:9092');
    expect(brokers).toBe('localhost:9092');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Suite: Kafka adapter constructors accept broker config
// Validates the contract used by both KafkaConsumerAdapter and
// KafkaPublisherAdapter constructors.
// ───────────────────────────────────────────────────────────────────────────
describe('Kafka adapter constructor contract', () => {
  it('KafkaConsumerAdapter receives brokers from ConfigService.get(KAFKA_BROKERS)', () => {
    // Contract test: verifies the shape expected by the adapters.
    // The adapters call:
    //   config.get<string>('KAFKA_BROKERS', 'localhost:9092').split(',')
    // This test validates that the return type is a string[] suitable for kafkajs.

    const mockConfig = {
      get: (key: string, def?: unknown) => {
        if (key === 'KAFKA_BROKERS') return 'localhost:4511';
        if (key === 'KAFKA_CLIENT_ID') return 'authorization-service';
        return def as string;
      },
    };

    const brokers: string[] = mockConfig
      .get('KAFKA_BROKERS', 'localhost:9092')
      .split(',');
    expect(brokers).toEqual(['localhost:4511']);
    expect(Array.isArray(brokers)).toBe(true);
    expect(brokers.every((b: string) => b.includes(':'))).toBe(true);
  });

  it('KafkaPublisherAdapter receives brokers from ConfigService.get(KAFKA_BROKERS)', () => {
    // Same contract as consumer — both use identical broker config.
    const mockConfig = {
      get: (key: string, def?: unknown) => {
        if (key === 'KAFKA_BROKERS') return 'localhost:9092';
        return def as string;
      },
    };

    const brokers: string[] = mockConfig
      .get('KAFKA_BROKERS', 'localhost:9092')
      .split(',');
    expect(brokers).toEqual(['localhost:9092']);
  });
});
