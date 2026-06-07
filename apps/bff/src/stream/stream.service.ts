import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subject, Subscription } from 'rxjs';
import {
  IEventSourceConnector,
  EVENT_SOURCE_CONNECTOR,
  SseEvent,
} from './ports/event-source-connector.port';

export { SseEvent };

@Injectable()
export class StreamService {
  private readonly logger = new Logger(StreamService.name);
  private readonly subjects = new Map<string, Subject<SseEvent>>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly sseServerUrl: string;

  constructor(
    private readonly config: ConfigService,
    @Inject(EVENT_SOURCE_CONNECTOR) private readonly connector: IEventSourceConnector,
  ) {
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
    const sub = this.connector.connect(url).subscribe({
      next: (event) => subject.next(event),
      error: (err: unknown) => {
        this.logger.error(`SSE connection error for store ${storeId}`, err);
      },
    });
    this.subscriptions.set(storeId, sub);
    this.logger.log(`Connected to SSE server for store ${storeId}`);
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
