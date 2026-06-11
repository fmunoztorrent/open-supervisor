import { Injectable, Inject } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { INotificationSubscriber, NOTIFICATION_SUBSCRIBER, ILogger, LOGGER } from '@open-supervisor/shared-messaging';
import { trace, context, propagation, defaultTextMapSetter } from '@opentelemetry/api';

export interface SseEvent {
  data: string;
  type?: string;
}

@Injectable()
export class SseService {
  private readonly subjects = new Map<string, Subject<SseEvent>>();

  constructor(
    @Inject(NOTIFICATION_SUBSCRIBER)
    private readonly subscriber: INotificationSubscriber,
    @Inject(LOGGER)
    private readonly logger?: ILogger,
  ) {}

  async getStoreStream(storeId: string): Promise<Observable<SseEvent>> {
    const requestsChannel = `store:${storeId}:requests`;
    const dispatchesChannel = `store:${storeId}:dispatches`;

    if (!this.subjects.has(requestsChannel)) {
      const subject = new Subject<SseEvent>();
      this.subjects.set(requestsChannel, subject);

      await this.subscriber.subscribe(requestsChannel, (message: string) => {
        subject.next(this.buildSseEvent(message, 'authorization_request'));
      });

      await this.subscriber.subscribe(dispatchesChannel, (message: string) => {
        subject.next(this.buildSseEvent(message, 'physical_presence_dispatch'));
      });
    }

    return this.subjects.get(requestsChannel)!.asObservable();
  }

  private buildSseEvent(message: string, type: string): SseEvent {
    // Try to parse the Redis message to extract trace context and correlation_id
    try {
      const parsed = JSON.parse(message) as Record<string, unknown>;

      // Extract _trace envelope and set active span context
      const traceEnvelope = parsed._trace as Record<string, string> | undefined;
      if (traceEnvelope?.traceparent) {
        const carrier: Record<string, string> = {
          traceparent: traceEnvelope.traceparent,
        };
        if (traceEnvelope.tracestate) {
          carrier.tracestate = traceEnvelope.tracestate;
        }
        propagation.extract(context.active(), carrier, {
          get: (carrier, key) => carrier[key],
          keys: (carrier) => Object.keys(carrier),
        });
      }

      // Set correlation_id on logger if present
      if (parsed.correlation_id && typeof parsed.correlation_id === 'string') {
        this.logger?.setCorrelationId(parsed.correlation_id);
      }

      // Remove _trace from the forwarded data (internal metadata)
      if (traceEnvelope) {
        const { _trace, ...payload } = parsed;
        return { data: JSON.stringify(payload), type };
      }
    } catch {
      // Not JSON — pass through as-is
    }

    return { data: message, type };
  }
}
