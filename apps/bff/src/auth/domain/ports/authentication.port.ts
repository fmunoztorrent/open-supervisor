import { AuthResult } from '../entities/auth-result.entity';

export const AUTHENTICATION_PORT = 'AUTHENTICATION_PORT';

export interface IAuthenticationPort {
  authenticate(employeeId: string, password: string): Promise<AuthResult>;
}
