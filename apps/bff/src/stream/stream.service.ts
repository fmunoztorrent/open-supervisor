import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subject } from 'rxjs';
// eventsource@2.x CJS: default import fails at runtime; require() returns the constructor directly
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const EventSource: any = require('eventsource');

export interface SseEvent {
  data: string;
  type?: string;
}

@Injectable()
export class StreamService {
  private readonly logger = new Logger(StreamService.name);
  private readonly subjects = new Map<string, Subject<SseEvent>>();
  private readonly sources = new Map<string, any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
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

    // authorization_request: solicitudes de autorización (DISCOUNT, CANCEL, etc.)
    source.addEventListener('authorization_request', (event: { data: string }) => {
      subject.next({ data: event.data, type: 'authorization_request' });
    });

    // physical_presence_dispatch: notificaciones de presencia física
    // (PRICE_CHANGE auto-rechazado por SYSTEM). Ver bugfix
    // `e2e-outbox-fixes` (2026-06-04) — Bug 4. Antes, este listener
    // faltaba y el sse-server descartaba los eventos.
    source.addEventListener('physical_presence_dispatch', (event: { data: string }) => {
      subject.next({ data: event.data, type: 'physical_presence_dispatch' });
    });

    source.onerror = (_err: unknown) => {
      this.logger.error(`SSE connection error for store ${storeId}`);
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
