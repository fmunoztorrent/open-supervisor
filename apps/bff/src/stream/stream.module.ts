import { Module } from '@nestjs/common';
import { StreamController } from './stream.controller';
import { StreamService } from './stream.service';
import { EVENT_SOURCE_CONNECTOR } from './ports/event-source-connector.port';
import { EventSourceAdapter } from './infrastructure/event-source.adapter';

@Module({
  controllers: [StreamController],
  providers: [
    StreamService,
    { provide: EVENT_SOURCE_CONNECTOR, useClass: EventSourceAdapter },
  ],
})
export class StreamModule {}
