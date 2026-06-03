import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subject } from 'rxjs';
import EventSource from 'eventsource';

export interface SseEvent {
  data: string;
  type?: string;
}

@Injectable()
export class StreamService {
  private readonly logger = new Logger(StreamService.name);
  private readonly subjects = new Map<string, Subject<SseEvent>>();
  private readonly sources = new Map<string, EventSource>();
  private readonly sseServerUrl: string;

  constructor(private readonly config: ConfigService) {
    this.sseServerUrl = config.get<string>('SSE_SERVER_URL', 'http://localhost:3002');
  }

  getStoreStream(storeId: string): Observable<SseEvent> {
    if (!this.subjects.has(storeId)) {
      const subject = new Subject<SseEvent>();
      this.subjects.set(storeId, subject);
      this.connectToSseServer(storeId, subject);
    }

    return this.subjects.get(storeId)!.asObservable();
  }

  private connectToSseServer(storeId: string, subject: Subject<SseEvent>): void {
    const url = `${this.sseServerUrl}/events/store/${storeId}`;
    const source = new EventSource(url);

    source.addEventListener('authorization_request', (event) => {
      subject.next({ data: event.data, type: 'authorization_request' });
    });

    source.onerror = (err) => {
      this.logger.error(`SSE connection error for store ${storeId}`, err);
    };

    this.sources.set(storeId, source);
    this.logger.log(`Connected to SSE server for store ${storeId}`);
  }

  onModuleDestroy(): void {
    for (const source of this.sources.values()) {
      source.close();
    }
  }
}
