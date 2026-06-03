export const MESSAGE_PUBLISHER = 'MESSAGE_PUBLISHER';

export interface IMessagePublisher {
  publish(topic: string, message: unknown): Promise<void>;
}
