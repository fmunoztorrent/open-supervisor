import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LOGGER } from '@open-supervisor/shared-messaging';
import { AuthorizationController } from './authorization.controller';
import { AuthorizationService } from './authorization.service';
import { PinoLoggerAdapter } from '../infrastructure/logging/pino-logger.adapter';

@Module({
  imports: [HttpModule],
  controllers: [AuthorizationController],
  providers: [
    AuthorizationService,
    { provide: LOGGER, useFactory: () => new PinoLoggerAdapter('bff') },
  ],
})
export class AuthorizationModule {}
