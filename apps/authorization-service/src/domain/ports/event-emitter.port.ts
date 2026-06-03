export const EVENT_EMITTER = 'EVENT_EMITTER';

export interface IEventEmitter {
  emit(channel: string, payload: unknown): Promise<void>;
}
