import { Injectable, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subject, Subscription } from 'rxjs';
import { ILogger, LOGGER } from '@open-supervisor/shared-messaging';
import {
  IEventSourceConnector,
  EVENT_SOURCE_CONNECTOR,
  SseEvent,
} from './ports/event-source-connector.port';

export { SseEvent };

@Injectable()
export class StreamService {
  private readonly subjects = new Map<string, Subject<SseEvent>>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly sseServerUrl: string;
  private readonly logger: ILogger;

  constructor(
    private readonly config: ConfigService,
    @Inject(EVENT_SOURCE_CONNECTOR) private readonly connector: IEventSourceConnector,
    @Optional() @Inject(LOGGER) logger?: ILogger,
  ) {
    this.sseServerUrl = config.get<string>('SSE_SERVER_URL', 'http://localhost:3002');
    this.logger = logger ?? {
      info: () => {},
      warn: () => {},
      error: console.error,
      debug: () => {},
      setCorrelationId: () => {},
    } as ILogger;
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
    const sub = this.connector.connect(url).subscribe({
      next: (event) => {
        // Extract correlation_id from SSE event data and set on logger
        this.extractCorrelationId(event);
        subject.next(event);
      },
      error: (err: unknown) => {
        this.logger.error(`SSE connection error for store ${storeId}`, err as Error);
      },
    });
    this.subscriptions.set(storeId, sub);
    this.logger.info(`Connected to SSE server for store ${storeId}`);
  }

  private extractCorrelationId(event: SseEvent): void {
    try {
      const parsed = JSON.parse(event.data) as Record<string, unknown>;
      if (parsed.correlation_id && typeof parsed.correlation_id === 'string') {
        this.logger.setCorrelationId(parsed.correlation_id);
      }
    } catch {
      // Not JSON — skip
    }
  }

  onModuleDestroy(): void {
    for (const sub of this.subscriptions.values()) {
      sub.unsubscribe();
    }
    for (const subject of this.subjects.values()) {
      subject.complete();
    }
  }
}
