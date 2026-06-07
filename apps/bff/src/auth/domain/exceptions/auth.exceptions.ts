export class InvalidCredentialsException extends Error {
  constructor() {
    super('Credenciales inválidas');
    this.name = 'InvalidCredentialsException';
  }
}

export class AccountDisabledException extends Error {
  constructor() {
    super('Cuenta deshabilitada');
    this.name = 'AccountDisabledException';
  }
}

export class AuthenticationUnavailableException extends Error {
  constructor(cause?: string) {
    super(`Servicio de autenticación no disponible${cause ? `: ${cause}` : ''}`);
    this.name = 'AuthenticationUnavailableException';
  }
}
