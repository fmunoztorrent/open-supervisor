export const NOTIFICATION_SUBSCRIBER = 'NOTIFICATION_SUBSCRIBER';

export interface INotificationSubscriber {
  subscribe(channel: string, handler: (message: string) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
}
