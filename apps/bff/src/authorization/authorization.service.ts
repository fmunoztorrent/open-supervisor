import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ResolvePayload {
  decision: 'APPROVE' | 'REJECT';
  supervisor_id: string;
}

@Injectable()
export class AuthorizationService {
  private readonly logger = new Logger(AuthorizationService.name);
  private readonly authServiceUrl: string;

  constructor(private readonly config: ConfigService) {
    this.authServiceUrl = config.get<string>('AUTH_SERVICE_URL', 'http://localhost:3001');
  }

  async resolve(id: string, payload: ResolvePayload): Promise<unknown> {
    const url = `${this.authServiceUrl}/authorization/${id}/resolve`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      this.logger.error(`Auth service responded ${response.status} for ${id}`);
      throw new Error(`Auth service error: ${response.status}`);
    }

    return response.json();
  }

  async getPending(storeId: string): Promise<unknown> {
    const url = `${this.authServiceUrl}/authorization/store/${storeId}/pending`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Auth service error: ${response.status}`);
    }

    return response.json();
  }
}
