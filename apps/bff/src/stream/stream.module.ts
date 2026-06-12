import { Module } from '@nestjs/common';
import { LOGGER } from '@open-supervisor/shared-messaging';
import { StreamController } from './stream.controller';
import { StreamService } from './stream.service';
import { EVENT_SOURCE_CONNECTOR } from './ports/event-source-connector.port';
import { EventSourceAdapter } from './infrastructure/event-source.adapter';
import { PinoLoggerAdapter } from '../infrastructure/logging/pino-logger.adapter';

@Module({
  controllers: [StreamController],
  providers: [
    StreamService,
    { provide: EVENT_SOURCE_CONNECTOR, useClass: EventSourceAdapter },
    { provide: LOGGER, useFactory: () => new PinoLoggerAdapter('bff') },
  ],
})
export class StreamModule {}
