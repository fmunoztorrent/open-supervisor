import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { isAxiosError } from 'axios';
import { IAuthenticationPort } from '../../domain/ports/authentication.port';
import { AuthResult } from '../../domain/entities/auth-result.entity';
import {
  InvalidCredentialsException,
  AccountDisabledException,
  AuthenticationUnavailableException,
} from '../../domain/exceptions/auth.exceptions';

interface KeycloakTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface KeycloakErrorResponse {
  error: string;
  error_description?: string;
}

@Injectable()
export class KeycloakAuthenticationAdapter implements IAuthenticationPort {
  constructor(
    private readonly httpService: HttpService,
    private readonly keycloakUrl: string,
    private readonly realm: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  async authenticate(
    employeeId: string,
    password: string,
  ): Promise<AuthResult> {
    const tokenUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`;

    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      username: employeeId,
      password,
    });

    try {
      const response = await firstValueFrom(
        this.httpService.post<KeycloakTokenResponse>(tokenUrl, body, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }),
      );

      return {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        expires_in: response.data.expires_in,
      };
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data as KeycloakErrorResponse | undefined;

        if (status === 401) {
          throw new InvalidCredentialsException();
        }

        if (status === 403) {
          throw new AccountDisabledException();
        }

        // 5xx, timeout (no response), or any other error
        throw new AuthenticationUnavailableException(
          data?.error_description ?? error.message,
        );
      }

      throw error;
    }
  }
}
