export class EmployeeNotFoundException extends Error {
  constructor(employeeId: string) {
    super(`Employee not found in Active Directory: ${employeeId}`);
    this.name = 'EmployeeNotFoundException';
    Object.setPrototypeOf(this, EmployeeNotFoundException.prototype);
  }
}

export class AdLookupException extends Error {
  constructor(reason: string) {
    super(`Active Directory lookup failed: ${reason}`);
    this.name = 'AdLookupException';
    Object.setPrototypeOf(this, AdLookupException.prototype);
  }
}
