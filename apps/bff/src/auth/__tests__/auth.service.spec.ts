import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../auth.service';
import { AUTHENTICATION_PORT, IAuthenticationPort } from '../domain/ports/authentication.port';
import { AuthResult } from '../domain/entities/auth-result.entity';
import {
  InvalidCredentialsException,
  AccountDisabledException,
  AuthenticationUnavailableException,
} from '../domain/exceptions/auth.exceptions';

describe('AuthService', () => {
  let service: AuthService;
  let mockPort: jest.Mocked<IAuthenticationPort>;

  const VALID_EMPLOYEE_ID = '12345678-9';
  const VALID_PASSWORD = 'correcta';

  const mockAuthResult: AuthResult = {
    access_token: 'eyJhbG...',
    refresh_token: 'eyJhbG...ref',
    expires_in: 28800,
  };

  beforeEach(async () => {
    mockPort = {
      authenticate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AUTHENTICATION_PORT, useValue: mockPort },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('login', () => {
    it('llama al port IAuthenticationPort.authenticate con las credenciales correctas', async () => {
      mockPort.authenticate.mockResolvedValue(mockAuthResult);

      await service.login(VALID_EMPLOYEE_ID, VALID_PASSWORD);

      expect(mockPort.authenticate).toHaveBeenCalledWith(
        VALID_EMPLOYEE_ID,
        VALID_PASSWORD,
      );
    });

    it('retorna AuthResult cuando las credenciales son válidas', async () => {
      mockPort.authenticate.mockResolvedValue(mockAuthResult);

      const result = await service.login(VALID_EMPLOYEE_ID, VALID_PASSWORD);

      expect(result).toEqual({
        access_token: mockAuthResult.access_token,
        refresh_token: mockAuthResult.refresh_token,
        expires_in: mockAuthResult.expires_in,
      });
    });

    it('lanza InvalidCredentialsException cuando el port lanza InvalidCredentialsException', async () => {
      mockPort.authenticate.mockRejectedValue(new InvalidCredentialsException());

      await expect(
        service.login(VALID_EMPLOYEE_ID, 'wrong'),
      ).rejects.toThrow(InvalidCredentialsException);
    });

    it('lanza AccountDisabledException cuando el port lanza AccountDisabledException', async () => {
      mockPort.authenticate.mockRejectedValue(new AccountDisabledException());

      await expect(
        service.login(VALID_EMPLOYEE_ID, VALID_PASSWORD),
      ).rejects.toThrow(AccountDisabledException);
    });

    it('lanza AuthenticationUnavailableException cuando el port lanza AuthenticationUnavailableException', async () => {
      mockPort.authenticate.mockRejectedValue(
        new AuthenticationUnavailableException('timeout'),
      );

      await expect(
        service.login(VALID_EMPLOYEE_ID, VALID_PASSWORD),
      ).rejects.toThrow(AuthenticationUnavailableException);
    });

    it('propaga errores inesperados del port sin modificarlos', async () => {
      const unexpected = new Error('boom');
      mockPort.authenticate.mockRejectedValue(unexpected);

      await expect(
        service.login(VALID_EMPLOYEE_ID, VALID_PASSWORD),
      ).rejects.toThrow('boom');
    });
  });
});
