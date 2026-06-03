import { HttpService } from '@nestjs/axios';
import { AxiosError, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { ActiveDirectoryUser } from '../../domain/entities/active-directory-user.entity';
import {
  EmployeeNotFoundException,
  AdLookupException,
} from '../../domain/exceptions/active-directory.exceptions';
import { HttpActiveDirectoryAdapter } from './http-active-directory.adapter';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeAxiosResponse(data: unknown, status = 200): AxiosResponse {
  return {
    data,
    status,
    statusText: 'OK',
    headers: {},
    config: {} as any,
  };
}

function makeAxiosError(status?: number): AxiosError {
  const err = new AxiosError('error');
  if (status !== undefined) {
    (err as any).response = makeAxiosResponse({}, status);
  }
  return err;
}

const AD_BASE_URL = 'http://ad-service';
const EMPLOYEE_ID = '12345678-9';

// ─── mocks ──────────────────────────────────────────────────────────────────

let mockHttpService: jest.Mocked<Pick<HttpService, 'get'>>;
let adapter: HttpActiveDirectoryAdapter;

beforeEach(() => {
  mockHttpService = { get: jest.fn() };

  adapter = new HttpActiveDirectoryAdapter(
    mockHttpService as unknown as HttpService,
    AD_BASE_URL,
  );
});

// ─── scenarios ──────────────────────────────────────────────────────────────

describe('HttpActiveDirectoryAdapter', () => {
  describe('lookupByEmployeeId — respuesta 200 válida', () => {
    it('realiza GET al endpoint correcto y mapea la respuesta al tipo ActiveDirectoryUser', async () => {
      const rawResponse = {
        displayName: 'Ana Gómez',
        jobTitle: 'Supervisora',
        department: 'Ventas',
        associate: true,
        accountEnabled: true,
      };
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse(rawResponse)));

      const result: ActiveDirectoryUser = await adapter.lookupByEmployeeId(EMPLOYEE_ID);

      expect(mockHttpService.get).toHaveBeenCalledWith(
        expect.stringContaining(EMPLOYEE_ID),
      );
      expect(result.displayName).toBe(rawResponse.displayName);
      expect(result.jobTitle).toBe(rawResponse.jobTitle);
      expect(result.department).toBe(rawResponse.department);
      expect(result.associate).toBe(true);
      expect(result.accountEnabled).toBe(true);
    });
  });

  describe('lookupByEmployeeId — HTTP 404', () => {
    it('lanza EmployeeNotFoundException (no AdLookupException)', async () => {
      mockHttpService.get.mockReturnValue(throwError(() => makeAxiosError(404)));

      await expect(adapter.lookupByEmployeeId(EMPLOYEE_ID)).rejects.toThrow(
        EmployeeNotFoundException,
      );
    });
  });

  describe('lookupByEmployeeId — HTTP 5xx', () => {
    it('lanza AdLookupException para HTTP 500', async () => {
      mockHttpService.get.mockReturnValue(throwError(() => makeAxiosError(500)));

      await expect(adapter.lookupByEmployeeId(EMPLOYEE_ID)).rejects.toThrow(
        AdLookupException,
      );
    });

    it('lanza AdLookupException para HTTP 503', async () => {
      mockHttpService.get.mockReturnValue(throwError(() => makeAxiosError(503)));

      await expect(adapter.lookupByEmployeeId(EMPLOYEE_ID)).rejects.toThrow(
        AdLookupException,
      );
    });
  });

  describe('lookupByEmployeeId — timeout (AxiosError sin response)', () => {
    it('lanza AdLookupException cuando no hay response (ECONNABORTED/timeout)', async () => {
      const timeoutError = new AxiosError('timeout');
      // sin .response, simula timeout
      mockHttpService.get.mockReturnValue(throwError(() => timeoutError));

      await expect(adapter.lookupByEmployeeId(EMPLOYEE_ID)).rejects.toThrow(
        AdLookupException,
      );
    });
  });

  describe('lookupByEmployeeId — HTTP 401/403', () => {
    it('lanza AdLookupException (no EmployeeNotFoundException) para 401', async () => {
      mockHttpService.get.mockReturnValue(throwError(() => makeAxiosError(401)));

      await expect(adapter.lookupByEmployeeId(EMPLOYEE_ID)).rejects.toThrow(
        AdLookupException,
      );
      await expect(adapter.lookupByEmployeeId(EMPLOYEE_ID)).rejects.not.toThrow(
        EmployeeNotFoundException,
      );
    });

    it('lanza AdLookupException (no EmployeeNotFoundException) para 403', async () => {
      mockHttpService.get.mockReturnValue(throwError(() => makeAxiosError(403)));

      await expect(adapter.lookupByEmployeeId(EMPLOYEE_ID)).rejects.toThrow(
        AdLookupException,
      );
    });
  });
});
