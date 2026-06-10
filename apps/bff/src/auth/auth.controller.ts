import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  InvalidCredentialsException,
  AccountDisabledException,
  AuthenticationUnavailableException,
} from './domain/exceptions/auth.exceptions';

class LoginDto {
  employeeId!: string;
  password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    try {
      return await this.authService.login(dto.employeeId, dto.password);
    } catch (error) {
      if (error instanceof InvalidCredentialsException) {
        throw new HttpException(
          { message: 'Credenciales inválidas' },
          HttpStatus.UNAUTHORIZED,
        );
      }
      if (error instanceof AccountDisabledException) {
        throw new HttpException(
          { message: 'Cuenta deshabilitada' },
          HttpStatus.FORBIDDEN,
        );
      }
      if (error instanceof AuthenticationUnavailableException) {
        throw new HttpException(
          { message: 'Servicio de autenticación no disponible' },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw error;
    }
  }
}
