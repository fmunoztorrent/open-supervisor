import { Injectable, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { IEventSourceConnector, SseEvent } from '../ports/event-source-connector.port';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const EventSource: any = require('eventsource');

@Injectable()
export class EventSourceAdapter implements IEventSourceConnector {
  private readonly logger = new Logger(EventSourceAdapter.name);

  connect(url: string): Observable<SseEvent> {
    return new Observable<SseEvent>((subscriber) => {
      const source = new EventSource(url);

      source.addEventListener('authorization_request', (event: { data: string }) => {
        subscriber.next({ data: event.data, type: 'authorization_request' });
      });

      source.addEventListener('physical_presence_dispatch', (event: { data: string }) => {
        subscriber.next({ data: event.data, type: 'physical_presence_dispatch' });
      });

      source.onerror = (err: unknown) => {
        this.logger.error('SSE connection error', err);
      };

      return () => {
        source.close();
      };
    });
  }
}
