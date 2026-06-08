import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StreamModule } from './stream/stream.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    StreamModule,
    AuthorizationModule,
    AuthModule,
  ],
})
export class AppModule {}
