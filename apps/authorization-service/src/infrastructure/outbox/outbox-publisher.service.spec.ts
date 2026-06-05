import { ConfigService } from '@nestjs/config';
import { OutboxPublisherService } from './outbox-publisher.service';
import { IOutboxRepository, OutboxEntry } from '../../domain/ports/outbox-repository.port';
import { IMessagePublisher } from '@open-supervisor/shared-messaging';

describe('OutboxPublisherService', () => {
  let service: OutboxPublisherService;
  let outboxRepo: jest.Mocked<IOutboxRepository>;
  let kafkaPublisher: jest.Mocked<IMessagePublisher>;
  let config: jest.Mocked<ConfigService>;

  const makeEntry = (id: string, topic: string, payload: unknown): OutboxEntry => ({
    id,
    correlationId: `corr-${id}`,
    topic,
    payload,
    status: 'PENDING',
    attempts: 0,
    createdAt: new Date('2026-06-04T10:00:00Z'),
    publishedAt: null,
    lastError: null,
  });

  beforeEach(() => {
    outboxRepo = {
      save: jest.fn(),
      findPending: jest.fn(),
      markPublished: jest.fn(),
      incrementAttempts: jest.fn(),
      getStats: jest.fn(),
    };
    kafkaPublisher = { publish: jest.fn() };
    config = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;
    // defaults: 1000ms interval, 50 batch size
    config.get.mockImplementation((key: string, def?: unknown) => {
      if (key === 'OUTBOX_TICK_INTERVAL_MS') return 1000;
      if (key === 'OUTBOX_BATCH_SIZE') return 50;
      return def as number;
    });
    service = new OutboxPublisherService(outboxRepo, kafkaPublisher, config);
  });

  describe('tick()', () => {
    it('calls kafkaPublisher.publish for each pending entry with the same topic and payload', async () => {
      // Arrange
      const entries = [makeEntry('1', 'auth.response.store-1', { store_id: 's1' }), makeEntry('2', 'auth.response.store-2', { store_id: 's2' })];
      outboxRepo.findPending.mockResolvedValue(entries);
      kafkaPublisher.publish.mockResolvedValue();

      // Act
      await service.tick();

      // Assert
      expect(outboxRepo.findPending).toHaveBeenCalledWith(expect.any(Number));
      expect(kafkaPublisher.publish).toHaveBeenCalledTimes(2);
      expect(kafkaPublisher.publish).toHaveBeenNthCalledWith(1, 'auth.response.store-1', { store_id: 's1' });
      expect(kafkaPublisher.publish).toHaveBeenNthCalledWith(2, 'auth.response.store-2', { store_id: 's2' });
    });

    it('marks entry as PUBLISHED after successful publish', async () => {
      // Arrange
      const entry = makeEntry('42', 'auth.response.s1', { correlation_id: 'c1' });
      outboxRepo.findPending.mockResolvedValue([entry]);
      kafkaPublisher.publish.mockResolvedValue();

      // Act
      await service.tick();

      // Assert
      expect(outboxRepo.markPublished).toHaveBeenCalledWith('42', expect.any(Date));
      expect(outboxRepo.incrementAttempts).not.toHaveBeenCalled();
    });

    it('increments attempts (and records lastError) when publish fails', async () => {
      // Arrange
      const entry = makeEntry('99', 'auth.response.s1', { correlation_id: 'c1' });
      outboxRepo.findPending.mockResolvedValue([entry]);
      const kafkaError = new Error('Broker unavailable');
      kafkaPublisher.publish.mockRejectedValue(kafkaError);

      // Act
      await service.tick();

      // Assert
      expect(outboxRepo.incrementAttempts).toHaveBeenCalledWith('99', kafkaError);
      expect(outboxRepo.markPublished).not.toHaveBeenCalled();
    });

    it('continues processing remaining entries when one publish fails', async () => {
      // Arrange
      const entries = [makeEntry('1', 't1', {}), makeEntry('2', 't2', {}), makeEntry('3', 't3', {})];
      outboxRepo.findPending.mockResolvedValue(entries);
      kafkaPublisher.publish
        .mockRejectedValueOnce(new Error('First failed'))
        .mockResolvedValueOnce()
        .mockResolvedValueOnce();

      // Act
      await service.tick();

      // Assert
      expect(kafkaPublisher.publish).toHaveBeenCalledTimes(3);
      expect(outboxRepo.incrementAttempts).toHaveBeenCalledWith('1', expect.any(Error));
      expect(outboxRepo.markPublished).toHaveBeenCalledWith('2', expect.any(Date));
      expect(outboxRepo.markPublished).toHaveBeenCalledWith('3', expect.any(Date));
    });

    it('does nothing when outbox is empty (no error, no publish)', async () => {
      // Arrange
      outboxRepo.findPending.mockResolvedValue([]);

      // Act
      await service.tick();

      // Assert
      expect(kafkaPublisher.publish).not.toHaveBeenCalled();
      expect(outboxRepo.markPublished).not.toHaveBeenCalled();
      expect(outboxRepo.incrementAttempts).not.toHaveBeenCalled();
    });

    it('does not crash when findPending throws (DB connection down)', async () => {
      // Arrange
      outboxRepo.findPending.mockRejectedValue(new Error('Connection refused'));

      // Act + Assert: tick() no debe lanzar; retorna stats vacíos en estado de error
      const result = await service.tick();
      expect(result).toEqual({ pending: 0, published: 0, failed: 0, durationMs: expect.any(Number) });
      expect(kafkaPublisher.publish).not.toHaveBeenCalled();
    });
  });


});
