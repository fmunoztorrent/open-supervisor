import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { KeycloakAuthenticationAdapter } from '../infrastructure/keycloak/keycloak-authentication.adapter';
import {
  InvalidCredentialsException,
  AccountDisabledException,
  AuthenticationUnavailableException,
} from '../domain/exceptions/auth.exceptions';

describe('KeycloakAuthenticationAdapter', () => {
  let adapter: KeycloakAuthenticationAdapter;
  let httpService: jest.Mocked<HttpService>;

  const KEYCLOAK_URL = 'http://keycloak:8080';
  const REALM = 'open-supervisor';
  const CLIENT_ID = 'bff';
  const CLIENT_SECRET = 'test-secret';

  const VALID_EMPLOYEE_ID = '12345678-9';
  const VALID_PASSWORD = 'correcta';

  function mockAxiosResponse<T>(data: T, status = 200): AxiosResponse<T> {
    return {
      data,
      status,
      statusText: 'OK',
      headers: {},
      config: {} as InternalAxiosRequestConfig,
    };
  }

  function mockAxiosError(status: number, data: unknown): AxiosError {
    const response = mockAxiosResponse(data, status);
    return {
      isAxiosError: true,
      response,
      message: `Request failed with status code ${status}`,
      name: 'AxiosError',
      toJSON: () => ({}),
      config: {} as InternalAxiosRequestConfig,
    } as AxiosError;
  }

  beforeEach(async () => {
    httpService = {
      post: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: KeycloakAuthenticationAdapter,
          useFactory: () =>
            new KeycloakAuthenticationAdapter(
              httpService as HttpService,
              KEYCLOAK_URL,
              REALM,
              CLIENT_ID,
              CLIENT_SECRET,
            ),
        },
      ],
    }).compile();

    adapter = module.get<KeycloakAuthenticationAdapter>(
      KeycloakAuthenticationAdapter,
    );
  });

  describe('authenticate', () => {
    it('llama a POST /realms/{realm}/protocol/openid-connect/token con ROPC grant', async () => {
      const tokenResponse = {
        access_token: 'token-abc',
        refresh_token: 'refresh-abc',
        expires_in: 28800,
      };
      httpService.post.mockReturnValue(of(mockAxiosResponse(tokenResponse)));

      await adapter.authenticate(VALID_EMPLOYEE_ID, VALID_PASSWORD);

      expect(httpService.post).toHaveBeenCalledWith(
        `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
        expect.any(URLSearchParams),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }),
      );

      const callBody = (httpService.post as jest.Mock).mock.calls[0][1];
      expect(callBody.get('grant_type')).toBe('password');
      expect(callBody.get('client_id')).toBe(CLIENT_ID);
      expect(callBody.get('client_secret')).toBe(CLIENT_SECRET);
      expect(callBody.get('username')).toBe(VALID_EMPLOYEE_ID);
      expect(callBody.get('password')).toBe(VALID_PASSWORD);
    });

    it('retorna AuthResult con los tokens de la respuesta de Keycloak', async () => {
      const tokenResponse = {
        access_token: 'token-abc',
        refresh_token: 'refresh-abc',
        expires_in: 28800,
      };
      httpService.post.mockReturnValue(of(mockAxiosResponse(tokenResponse)));

      const result = await adapter.authenticate(
        VALID_EMPLOYEE_ID,
        VALID_PASSWORD,
      );

      expect(result).toEqual({
        access_token: 'token-abc',
        refresh_token: 'refresh-abc',
        expires_in: 28800,
      });
    });

    it('lanza InvalidCredentialsException cuando Keycloak responde 401 invalid_grant', async () => {
      const error = mockAxiosError(401, {
        error: 'invalid_grant',
        error_description: 'Invalid user credentials',
      });
      httpService.post.mockReturnValue(throwError(() => error));

      await expect(
        adapter.authenticate(VALID_EMPLOYEE_ID, 'wrong'),
      ).rejects.toThrow(InvalidCredentialsException);
    });

    it('lanza AccountDisabledException cuando Keycloak responde 403 account disabled', async () => {
      const error = mockAxiosError(403, {
        error: 'account_disabled',
        error_description: 'Account is disabled',
      });
      httpService.post.mockReturnValue(throwError(() => error));

      await expect(
        adapter.authenticate('99999999-0', VALID_PASSWORD),
      ).rejects.toThrow(AccountDisabledException);
    });

    it('lanza AuthenticationUnavailableException cuando Keycloak responde 5xx', async () => {
      const error = mockAxiosError(500, { error: 'server_error' });
      httpService.post.mockReturnValue(throwError(() => error));

      await expect(
        adapter.authenticate(VALID_EMPLOYEE_ID, VALID_PASSWORD),
      ).rejects.toThrow(AuthenticationUnavailableException);
    });

    it('lanza AuthenticationUnavailableException en timeout sin respuesta', async () => {
      const error: AxiosError = {
        isAxiosError: true,
        message: 'timeout of 5000ms exceeded',
        name: 'AxiosError',
        toJSON: () => ({}),
        config: {} as InternalAxiosRequestConfig,
      } as AxiosError;
      httpService.post.mockReturnValue(throwError(() => error));

      await expect(
        adapter.authenticate(VALID_EMPLOYEE_ID, VALID_PASSWORD),
      ).rejects.toThrow(AuthenticationUnavailableException);
    });
  });
});
