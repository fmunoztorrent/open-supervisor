import { Body, Controller, Get, Param, Post, Query, ConflictException, BadRequestException } from '@nestjs/common';
import { ResolveAuthorizationUseCase } from '../domain/use-cases/resolve-authorization.use-case';
import { IAuthorizationRepository, AUTHORIZATION_REPOSITORY } from '../domain/ports/authorization-repository.port';
import { Inject } from '@nestjs/common';
import { ResolveAuthorizationDto } from './dtos/resolve-authorization.dto';
import { AuthorizationStatus } from '@open-supervisor/shared-types';

@Controller('authorization')
export class AuthorizationController {
  constructor(
    private readonly resolveUseCase: ResolveAuthorizationUseCase,
    @Inject(AUTHORIZATION_REPOSITORY)
    private readonly repository: IAuthorizationRepository,
  ) {}

  @Get('store/:storeId/pending')
  async getPending(@Param('storeId') storeId: string) {
    const requests = await this.repository.findPendingByStore(storeId);
    // El wire format debe coincidir con AuthorizationRequestDto (snake_case)
    // compartido entre todos los servicios y la app móvil.
    return requests.map((r) => ({
      id: r.id,
      store_id: r.storeId,
      pos_id: r.posId,
      correlation_id: r.correlationId,
      type: r.type,
      amount: r.amount,
      employee_id: r.employeeId,
      status: r.status,
      created_at: r.createdAt.toISOString(),
    }));
  }

  @Get('store/:storeId/history')
  async getHistory(@Param('storeId') storeId: string, @Query('status') status?: string, @Query('supervisorId') supervisorId?: string) {
    let resolvedStatus: AuthorizationStatus | undefined;
    if (status) {
      const upper = status.toUpperCase();
      if (upper !== AuthorizationStatus.APPROVED && upper !== AuthorizationStatus.REJECTED) {
        throw new BadRequestException(`Invalid status: ${status}. Valid values: APPROVED, REJECTED`);
      }
      resolvedStatus = upper as AuthorizationStatus;
    }
    const requests = await this.repository.findResolvedByStore(storeId, resolvedStatus, supervisorId);
    return requests.map((r) => ({
      id: r.id,
      store_id: r.storeId,
      pos_id: r.posId,
      correlation_id: r.correlationId,
      type: r.type,
      amount: r.amount,
      employee_id: r.employeeId,
      product_id: r.productId,
      original_price: r.originalPrice,
      requested_price: r.requestedPrice,
      status: r.status,
      resolved_by: r.resolvedBy,
      resolved_at: r.resolvedAt?.toISOString(),
      created_at: r.createdAt.toISOString(),
    }));
  }

  @Post(':id/resolve')
  async resolve(
    @Param('id') id: string,
    @Body() dto: ResolveAuthorizationDto,
  ) {
    try {
      const request = await this.resolveUseCase.execute(id, dto.decision, dto.supervisor_id);
      // Wire format snake_case consistente con el resto del API y con
      // el DTO compartido `AuthorizationResponseDto`. Ver bugfix
      // `e2e-outbox-fixes` (2026-06-04) — Bug 6.
      return {
        id: request.id,
        store_id: request.storeId,
        pos_id: request.posId,
        correlation_id: request.correlationId,
        status: request.status,
        resolved_by: request.resolvedBy,
        resolved_at: request.resolvedAt?.toISOString(),
        type: request.type,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('is already')) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }
}
