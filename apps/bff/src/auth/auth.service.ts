import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { AUTHENTICATION_PORT, IAuthenticationPort } from './domain/ports/authentication.port';
import { AuthResult } from './domain/entities/auth-result.entity';

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTHENTICATION_PORT)
    private readonly authenticationPort: IAuthenticationPort,
  ) {}

  async login(employeeId: string, password: string): Promise<AuthResult> {
    return this.authenticationPort.authenticate(employeeId, password);
  }
}
