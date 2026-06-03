import { Controller, Get, Param, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SseService, SseEvent } from './sse.service';

@Controller('events')
export class SseController {
  constructor(private readonly sseService: SseService) {}

  @Sse('store/:storeId')
  async storeEvents(@Param('storeId') storeId: string): Promise<Observable<SseEvent>> {
    return this.sseService.getStoreStream(storeId);
  }
}
