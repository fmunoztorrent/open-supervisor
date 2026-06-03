import { Injectable, Inject } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { INotificationSubscriber, NOTIFICATION_SUBSCRIBER } from '@open-supervisor/shared-messaging';

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
  ) {}

  async getStoreStream(storeId: string): Promise<Observable<SseEvent>> {
    const requestsChannel = `store:${storeId}:requests`;
    const dispatchesChannel = `store:${storeId}:dispatches`;

    if (!this.subjects.has(requestsChannel)) {
      const subject = new Subject<SseEvent>();
      this.subjects.set(requestsChannel, subject);

      await this.subscriber.subscribe(requestsChannel, (message: string) => {
        subject.next({ data: message, type: 'authorization_request' });
      });

      await this.subscriber.subscribe(dispatchesChannel, (message: string) => {
        subject.next({ data: message, type: 'physical_presence_dispatch' });
      });
    }

    return this.subjects.get(requestsChannel)!.asObservable();
  }
}
