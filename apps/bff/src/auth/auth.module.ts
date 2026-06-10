import { Module } from '@nestjs/common';
import { HttpModule, HttpService } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUTHENTICATION_PORT } from './domain/ports/authentication.port';
import { KeycloakAuthenticationAdapter } from './infrastructure/keycloak/keycloak-authentication.adapter';

@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        timeout: config.get<number>('KEYCLOAK_TIMEOUT_MS', 5000),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: AUTHENTICATION_PORT,
      useFactory: (httpService: HttpService, config: ConfigService) =>
        new KeycloakAuthenticationAdapter(
          httpService,
          config.getOrThrow<string>('KEYCLOAK_URL'),
          config.getOrThrow<string>('KEYCLOAK_REALM'),
          config.getOrThrow<string>('KEYCLOAK_CLIENT_ID'),
          config.getOrThrow<string>('KEYCLOAK_CLIENT_SECRET'),
        ),
      inject: [HttpService, ConfigService],
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
