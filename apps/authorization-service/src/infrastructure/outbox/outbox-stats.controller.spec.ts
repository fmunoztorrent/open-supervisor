import { OutboxStatsController } from './outbox-stats.controller';
import { IOutboxRepository, OutboxStats } from '../../domain/ports/outbox-repository.port';

describe('OutboxStatsController', () => {
  let controller: OutboxStatsController;
  let outboxRepo: jest.Mocked<IOutboxRepository>;

  beforeEach(() => {
    outboxRepo = {
      save: jest.fn(),
      findPending: jest.fn(),
      markPublished: jest.fn(),
      incrementAttempts: jest.fn(),
      getStats: jest.fn(),
    };
    controller = new OutboxStatsController(outboxRepo);
  });

  it('returns the outbox stats as JSON', async () => {
    // Arrange
    const stats: OutboxStats = {
      pendingCount: 4,
      publishedCountLastHour: 5,
      maxAttempts: 10,
      oldestPendingAgeSeconds: 3600,
    };
    outboxRepo.getStats.mockResolvedValue(stats);

    // Act
    const result = await controller.getStats();

    // Assert
    expect(result).toEqual({
      pending_count: 4,
      published_count_last_hour: 5,
      max_attempts: 10,
      oldest_pending_age_seconds: 3600,
    });
  });

  it('returns zeroed stats when outbox is empty', async () => {
    // Arrange
    outboxRepo.getStats.mockResolvedValue({
      pendingCount: 0,
      publishedCountLastHour: 0,
      maxAttempts: 0,
      oldestPendingAgeSeconds: 0,
    });

    // Act
    const result = await controller.getStats();

    // Assert
    expect(result).toEqual({
      pending_count: 0,
      published_count_last_hour: 0,
      max_attempts: 0,
      oldest_pending_age_seconds: 0,
    });
  });

  it('uses snake_case in the response (wire format)', async () => {
    // Arrange
    outboxRepo.getStats.mockResolvedValue({
      pendingCount: 1,
      publishedCountLastHour: 2,
      maxAttempts: 3,
      oldestPendingAgeSeconds: 4,
    });

    // Act
    const result = (await controller.getStats()) as Record<string, unknown>;

    // Assert
    expect(result).toHaveProperty('pending_count');
    expect(result).toHaveProperty('published_count_last_hour');
    expect(result).toHaveProperty('max_attempts');
    expect(result).toHaveProperty('oldest_pending_age_seconds');
    expect(result).not.toHaveProperty('pendingCount');
    expect(result).not.toHaveProperty('publishedCountLastHour');
  });
});
