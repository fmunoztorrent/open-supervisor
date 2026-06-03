import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StreamModule } from './stream/stream.module';
import { AuthorizationModule } from './authorization/authorization.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    StreamModule,
    AuthorizationModule,
  ],
})
export class AppModule {}
