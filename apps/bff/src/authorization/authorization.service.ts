import { Injectable, Logger, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface ResolvePayload {
  decision: 'APPROVE' | 'REJECT';
  supervisor_id: string;
}

@Injectable()
export class AuthorizationService {
  private readonly logger = new Logger(AuthorizationService.name);
  private readonly authServiceUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {
    this.authServiceUrl = config.get<string>('AUTH_SERVICE_URL', 'http://localhost:3001');
  }

  async resolve(id: string, payload: ResolvePayload): Promise<unknown> {
    const url = `${this.authServiceUrl}/authorization/${id}/resolve`;
    try {
      const response = await firstValueFrom(this.http.post<unknown>(url, payload));
      return response.data;
    } catch (error: unknown) {
      const axiosError = error as { response?: { status: number } };
      const status = axiosError.response?.status ?? 500;
      this.logger.error(`Auth service responded ${status} for ${id}`);
      throw new HttpException(`Auth service error: ${status}`, status);
    }
  }

  async getHistory(storeId: string, status?: string, supervisorId?: string): Promise<unknown> {
    let url = `${this.authServiceUrl}/authorization/store/${storeId}/history`;
    const params: string[] = [];
    if (status) {
      params.push(`status=${status}`);
    }
    if (supervisorId) {
      params.push(`supervisorId=${supervisorId}`);
    }
    if (params.length > 0) {
      url += `?${params.join('&')}`;
    }
    try {
      const response = await firstValueFrom(this.http.get<unknown>(url));
      return response.data;
    } catch (error: unknown) {
      const axiosError = error as { response?: { status: number } };
      const status = axiosError.response?.status ?? 500;
      this.logger.error(`Auth service responded ${status} for history ${storeId}`);
      throw new HttpException(`Auth service error: ${status}`, status);
    }
  }

  async getPending(storeId: string): Promise<unknown> {
    const url = `${this.authServiceUrl}/authorization/store/${storeId}/pending`;
    try {
      const response = await firstValueFrom(this.http.get<unknown>(url));
      return response.data;
    } catch (error: unknown) {
      const axiosError = error as { response?: { status: number } };
      const status = axiosError.response?.status ?? 500;
      throw new HttpException(`Auth service error: ${status}`, status);
    }
  }
}
