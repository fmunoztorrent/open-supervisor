import { ActiveDirectoryUser } from '../entities/active-directory-user.entity';

export const ACTIVE_DIRECTORY = 'ACTIVE_DIRECTORY';

export interface IActiveDirectoryPort {
  lookupByEmployeeId(employeeId: string): Promise<ActiveDirectoryUser>;
}
