import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AuthorizationService, ResolvePayload } from './authorization.service';

@Controller('authorization')
export class AuthorizationController {
  constructor(private readonly authService: AuthorizationService) {}

  @Get('store/:storeId/pending')
  async getPending(@Param('storeId') storeId: string) {
    return this.authService.getPending(storeId);
  }

  @Post(':id/resolve')
  async resolve(@Param('id') id: string, @Body() payload: ResolvePayload) {
    return this.authService.resolve(id, payload);
  }
}
