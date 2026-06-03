import { Controller, Get, Param, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { StreamService, SseEvent } from './stream.service';

@Controller('stream')
export class StreamController {
  constructor(private readonly streamService: StreamService) {}

  @Sse('store/:storeId')
  storeStream(@Param('storeId') storeId: string): Observable<SseEvent> {
    return this.streamService.getStoreStream(storeId);
  }
}
