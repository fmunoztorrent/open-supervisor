import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuthorizationService, ResolvePayload } from './authorization.service';

@Controller('authorization')
export class AuthorizationController {
  constructor(private readonly authService: AuthorizationService) {}

  @Get('store/:storeId/pending')
  async getPending(@Param('storeId') storeId: string) {
    return this.authService.getPending(storeId);
  }

  @Get('requests/history')
  async getHistory(@Query('storeId') storeId: string, @Query('status') status?: string, @Query('supervisorId') supervisorId?: string) {
    return this.authService.getHistory(storeId, status, supervisorId);
  }

  @Post(':id/resolve')
  async resolve(@Param('id') id: string, @Body() payload: ResolvePayload) {
    return this.authService.resolve(id, payload);
  }
}
