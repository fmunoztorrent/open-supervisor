import { Observable } from 'rxjs';

export interface SseEvent {
  type: 'authorization_request' | 'physical_presence_dispatch';
  data: string;
}

export interface IEventSourceConnector {
  connect(url: string): Observable<SseEvent>;
}

export const EVENT_SOURCE_CONNECTOR = 'EVENT_SOURCE_CONNECTOR';
