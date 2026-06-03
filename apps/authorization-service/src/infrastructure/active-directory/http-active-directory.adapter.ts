import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { IActiveDirectoryPort } from '../../domain/ports/active-directory.port';
import { ActiveDirectoryUser } from '../../domain/entities/active-directory-user.entity';
import {
  EmployeeNotFoundException,
  AdLookupException,
} from '../../domain/exceptions/active-directory.exceptions';

interface ActiveDirectoryUserDto {
  displayName: string;
  jobTitle: string;
  department: string;
  associate: boolean;
  accountEnabled: boolean;
}

@Injectable()
export class HttpActiveDirectoryAdapter implements IActiveDirectoryPort {
  constructor(
    private readonly httpService: HttpService,
    private readonly baseUrl: string,
  ) {}

  async lookupByEmployeeId(employeeId: string): Promise<ActiveDirectoryUser> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<ActiveDirectoryUserDto>(
          `${this.baseUrl}/users/${employeeId}`,
        ),
      );

      const dto = response.data;

      return {
        displayName: dto.displayName,
        jobTitle: dto.jobTitle,
        department: dto.department,
        associate: dto.associate,
        accountEnabled: dto.accountEnabled,
      };
    } catch (error) {
      if (error instanceof AxiosError) {
        const status = error.response?.status;

        if (status === 404) {
          throw new EmployeeNotFoundException(employeeId);
        }

        // 401, 403, 5xx, timeout (no response), or any other Axios error
        throw new AdLookupException(
          error.message ?? `HTTP ${status ?? 'unknown'}`,
        );
      }

      throw error;
    }
  }
}
