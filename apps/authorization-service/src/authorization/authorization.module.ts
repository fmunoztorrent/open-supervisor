import { Module, OnModuleInit, Inject, Logger } from '@nestjs/common';
import { HttpModule, HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { MESSAGE_CONSUMER, IMessageConsumer, MESSAGE_PUBLISHER } from '@open-supervisor/shared-messaging';
import { AuthorizationController } from './authorization.controller';
import {
  ProcessAuthorizationRequestUseCase,
  VERIFY_EMPLOYEE_BENEFIT,
  PROCESS_PRICE_CHANGE,
} from '../domain/use-cases/process-authorization-request.use-case';
import { ResolveAuthorizationUseCase } from '../domain/use-cases/resolve-authorization.use-case';
import { VerifyEmployeeBenefitUseCase } from '../domain/use-cases/verify-employee-benefit.use-case';
import { ProcessPriceChangeUseCase } from '../domain/use-cases/process-price-change.use-case';
import { AUTHORIZATION_REPOSITORY } from '../domain/ports/authorization-repository.port';
import { EVENT_EMITTER } from '../domain/ports/event-emitter.port';
import { ACTIVE_DIRECTORY } from '../domain/ports/active-directory.port';
import { OUTBOX_REPOSITORY } from '../domain/ports/outbox-repository.port';
import { UNIT_OF_WORK } from '../domain/ports/unit-of-work.port';
import { KafkaConsumerAdapter } from '../infrastructure/messaging/kafka/kafka-consumer.adapter';
import { KafkaPublisherAdapter } from '../infrastructure/messaging/kafka/kafka-publisher.adapter';
import { RedisPublisherAdapter } from '../infrastructure/events/redis-publisher.adapter';
import { DrizzleModule } from '../infrastructure/persistence/drizzle/drizzle.provider';
import { DrizzleAuthorizationRepository } from '../infrastructure/persistence/drizzle/drizzle-authorization.repository';
import { DrizzleOutboxRepository } from '../infrastructure/persistence/drizzle/drizzle-outbox.repository';
import { DrizzleUnitOfWork } from '../infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { HttpActiveDirectoryAdapter } from '../infrastructure/active-directory/http-active-directory.adapter';
import { OutboxPublisherService } from '../infrastructure/outbox/outbox-publisher.service';
import { OutboxStatsController } from '../infrastructure/outbox/outbox-stats.controller';
import { AuthorizationRequestDto } from '@open-supervisor/shared-types';

@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        baseURL: config.get<string>('AD_BASE_URL', 'http://localhost:8080'),
        timeout: config.get<number>('AD_LOOKUP_TIMEOUT_MS', 60000),
      }),
    }),
    DrizzleModule,
  ],
  controllers: [AuthorizationController, OutboxStatsController],
  providers: [
    { provide: AUTHORIZATION_REPOSITORY, useClass: DrizzleAuthorizationRepository },
    { provide: OUTBOX_REPOSITORY, useClass: DrizzleOutboxRepository },
    { provide: UNIT_OF_WORK, useClass: DrizzleUnitOfWork },
    { provide: MESSAGE_PUBLISHER, useClass: KafkaPublisherAdapter },
    { provide: MESSAGE_CONSUMER, useClass: KafkaConsumerAdapter },
    { provide: EVENT_EMITTER, useClass: RedisPublisherAdapter },
    {
      provide: ACTIVE_DIRECTORY,
      useFactory: (httpService: any, config: ConfigService) =>
        new HttpActiveDirectoryAdapter(
          httpService,
          config.get<string>('AD_BASE_URL', 'http://localhost:8080'),
        ),
      inject: [HttpService, ConfigService],
    },
    {
      provide: VerifyEmployeeBenefitUseCase,
      useFactory: (
        activeDirectory: any,
        publisher: any,
        eventEmitter: any,
        repository: any,
      ) =>
        new VerifyEmployeeBenefitUseCase(
          activeDirectory,
          publisher,
          eventEmitter,
          repository,
          new Logger(VerifyEmployeeBenefitUseCase.name),
        ),
      inject: [ACTIVE_DIRECTORY, MESSAGE_PUBLISHER, EVENT_EMITTER, AUTHORIZATION_REPOSITORY],
    },
    {
      provide: VERIFY_EMPLOYEE_BENEFIT,
      useExisting: VerifyEmployeeBenefitUseCase,
    },
    {
      provide: ProcessPriceChangeUseCase,
      useFactory: (publisher: any, repository: any, eventEmitter: any) =>
        new ProcessPriceChangeUseCase(publisher, repository, eventEmitter),
      inject: [MESSAGE_PUBLISHER, AUTHORIZATION_REPOSITORY, EVENT_EMITTER],
    },
    {
      provide: PROCESS_PRICE_CHANGE,
      useExisting: ProcessPriceChangeUseCase,
    },
    {
      provide: ProcessAuthorizationRequestUseCase,
      useFactory: (
        repository: any,
        eventEmitter: any,
        verifyEmployeeBenefit: any,
        processPriceChange: any,
      ) =>
        new ProcessAuthorizationRequestUseCase(
          repository,
          eventEmitter,
          verifyEmployeeBenefit,
          processPriceChange,
        ),
      inject: [AUTHORIZATION_REPOSITORY, EVENT_EMITTER, VERIFY_EMPLOYEE_BENEFIT, PROCESS_PRICE_CHANGE],
    },
    ResolveAuthorizationUseCase,
    OutboxPublisherService,
  ],
})
export class AuthorizationModule implements OnModuleInit {
  constructor(
    @Inject(MESSAGE_CONSUMER) private readonly consumer: IMessageConsumer,
    private readonly processUseCase: ProcessAuthorizationRequestUseCase,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.consumer.subscribe(
      ['auth.requests'],
      'authorization-service-group',
      async (_topic: string, message: unknown) => {
        await this.processUseCase.execute(message as AuthorizationRequestDto);
      },
    );
  }
}
