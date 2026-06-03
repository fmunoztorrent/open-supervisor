export const MESSAGE_CONSUMER = 'MESSAGE_CONSUMER';

export interface IMessageConsumer {
  subscribe(
    topics: string[],
    groupId: string,
    handler: (topic: string, message: unknown) => Promise<void>,
  ): Promise<void>;

  disconnect(): Promise<void>;
}
