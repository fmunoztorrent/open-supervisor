import { Body, Controller, Get, Param, Post, ConflictException } from '@nestjs/common';
import { ResolveAuthorizationUseCase } from '../domain/use-cases/resolve-authorization.use-case';
import { IAuthorizationRepository, AUTHORIZATION_REPOSITORY } from '../domain/ports/authorization-repository.port';
import { Inject } from '@nestjs/common';
import { ResolveAuthorizationDto } from './dtos/resolve-authorization.dto';

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

  @Post(':id/resolve')
  async resolve(
    @Param('id') id: string,
    @Body() dto: ResolveAuthorizationDto,
  ) {
    try {
      const request = await this.resolveUseCase.execute(id, dto.decision, dto.supervisor_id);
      return {
        id: request.id,
        status: request.status,
        resolvedBy: request.resolvedBy,
        resolvedAt: request.resolvedAt?.toISOString(),
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('is already')) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }
}
