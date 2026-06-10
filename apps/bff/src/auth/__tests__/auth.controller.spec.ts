import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import {
  InvalidCredentialsException,
  AccountDisabledException,
  AuthenticationUnavailableException,
} from '../domain/exceptions/auth.exceptions';

describe('AuthController', () => {
  let controller: AuthController;
  let mockAuthService: jest.Mocked<AuthService>;

  const VALID_EMPLOYEE_ID = '12345678-9';
  const VALID_PASSWORD = 'correcta';

  const loginDto = {
    employeeId: VALID_EMPLOYEE_ID,
    password: VALID_PASSWORD,
  };

  const mockTokenResponse = {
    access_token: 'token-abc',
    refresh_token: 'refresh-abc',
    expires_in: 28800,
  };

  beforeEach(async () => {
    mockAuthService = {
      login: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('POST /auth/login', () => {
    it('retorna 200 con tokens cuando las credenciales son válidas', async () => {
      mockAuthService.login.mockResolvedValue(mockTokenResponse);

      const result = await controller.login(loginDto);

      expect(result).toEqual(mockTokenResponse);
      expect(mockAuthService.login).toHaveBeenCalledWith(
        VALID_EMPLOYEE_ID,
        VALID_PASSWORD,
      );
    });

    it('lanza HttpException 401 cuando las credenciales son inválidas', async () => {
      mockAuthService.login.mockRejectedValue(
        new InvalidCredentialsException(),
      );

      await expect(controller.login(loginDto)).rejects.toMatchObject({
        status: 401,
        message: 'Credenciales inválidas',
      });
    });

    it('lanza HttpException 403 cuando la cuenta está deshabilitada', async () => {
      mockAuthService.login.mockRejectedValue(new AccountDisabledException());

      await expect(controller.login(loginDto)).rejects.toMatchObject({
        status: 403,
        message: 'Cuenta deshabilitada',
      });
    });

    it('lanza HttpException 503 cuando el servicio de autenticación no está disponible', async () => {
      mockAuthService.login.mockRejectedValue(
        new AuthenticationUnavailableException('timeout'),
      );

      await expect(controller.login(loginDto)).rejects.toMatchObject({
        status: 503,
        message: 'Servicio de autenticación no disponible',
      });
    });
  });
});
