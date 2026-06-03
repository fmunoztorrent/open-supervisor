import { renderHook, act, waitFor } from '@testing-library/react-native';
import EventSource from 'react-native-sse';
import { AuthorizationRequestDto, RequestType } from '@open-supervisor/shared-types';

// Este import fallará con "Cannot find module" hasta que el hook sea implementado.
import { useSSERequests } from '../useSSERequests';

// EventSource ya está mockeado globalmente en jest.setup.js.
// Necesitamos acceso al mock para capturar los addEventListener calls.
const MockEventSource = EventSource as jest.MockedClass<typeof EventSource>;

const makePendingRequest = (correlationId: string): AuthorizationRequestDto => ({
  store_id: 'store-42',
  pos_id: 'pos-1',
  correlation_id: correlationId,
  type: RequestType.DISCOUNT,
  created_at: '2026-06-03T10:30:00.000Z',
});

// Helper: obtiene el callback registrado para un eventType dado.
function getEventSourceListener(
  eventSourceInstance: jest.Mocked<InstanceType<typeof EventSource>>,
  eventType: string,
): (event: { data: string }) => void {
  const calls = (eventSourceInstance.addEventListener as jest.Mock).mock.calls;
  const call = calls.find(([type]: [string]) => type === eventType);
  if (!call) {
    throw new Error(`No se registró listener para el evento "${eventType}"`);
  }
  return call[1];
}

describe('useSSERequests', () => {
  const STORE_ID = 'store-42';

  beforeEach(() => {
    MockEventSource.mockClear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('carga inicial (GET pending)', () => {
    it('hace GET a /authorization/store/:storeId/pending al montar', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      renderHook(() => useSSERequests(STORE_ID));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining(`/authorization/store/${STORE_ID}/pending`),
        );
      });
    });

    it('devuelve las solicitudes retornadas por el GET en requests', async () => {
      const pending = [
        makePendingRequest('corr-1'),
        makePendingRequest('corr-2'),
      ];
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => pending,
      });

      const { result } = renderHook(() => useSSERequests(STORE_ID));

      await waitFor(() => {
        expect(result.current.requests).toHaveLength(2);
      });
      expect(result.current.requests[0].correlation_id).toBe('corr-1');
      expect(result.current.requests[1].correlation_id).toBe('corr-2');
    });
  });

  describe('conexión SSE', () => {
    beforeEach(() => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => [],
      });
    });

    it('crea un EventSource que conecta a /stream/store/:storeId', async () => {
      renderHook(() => useSSERequests(STORE_ID));

      await waitFor(() => {
        expect(MockEventSource).toHaveBeenCalledWith(
          expect.stringContaining(`/stream/store/${STORE_ID}`),
          expect.anything(),
        );
      });
    });

    it('registra listener para el evento authorization_request', async () => {
      renderHook(() => useSSERequests(STORE_ID));

      await waitFor(() => {
        expect(MockEventSource).toHaveBeenCalledTimes(1);
      });

      const instance = MockEventSource.mock.instances[0] as jest.Mocked<
        InstanceType<typeof EventSource>
      >;

      expect(instance.addEventListener).toHaveBeenCalledWith(
        'authorization_request',
        expect.any(Function),
      );
    });

    it('agrega la nueva solicitud al inicio de requests cuando llega authorization_request', async () => {
      const initial = [makePendingRequest('corr-existing')];
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => initial,
      });

      const { result } = renderHook(() => useSSERequests(STORE_ID));

      await waitFor(() => {
        expect(result.current.requests).toHaveLength(1);
      });

      const instance = MockEventSource.mock.instances[0] as jest.Mocked<
        InstanceType<typeof EventSource>
      >;
      const listener = getEventSourceListener(instance, 'authorization_request');

      const newRequest = makePendingRequest('corr-new');

      await act(async () => {
        listener({ data: JSON.stringify(newRequest) });
      });

      expect(result.current.requests).toHaveLength(2);
      // La nueva solicitud queda al inicio
      expect(result.current.requests[0].correlation_id).toBe('corr-new');
      expect(result.current.requests[1].correlation_id).toBe('corr-existing');
    });
  });

  describe('cleanup al desmontar', () => {
    it('llama removeAllEventListeners y close sobre el EventSource al desmontar', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      const { unmount } = renderHook(() => useSSERequests(STORE_ID));

      await waitFor(() => {
        expect(MockEventSource).toHaveBeenCalledTimes(1);
      });

      const instance = MockEventSource.mock.instances[0] as jest.Mocked<
        InstanceType<typeof EventSource>
      >;

      unmount();

      expect(instance.removeAllEventListeners).toHaveBeenCalled();
      expect(instance.close).toHaveBeenCalled();
    });
  });

  describe('reconexión SSE (US-03)', () => {
    beforeEach(() => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => [],
      });
    });

    it('expone isReconnecting=true cuando el EventSource emite evento error', async () => {
      const { result } = renderHook(() => useSSERequests(STORE_ID));

      await waitFor(() => {
        expect(MockEventSource).toHaveBeenCalledTimes(1);
      });

      const instance = MockEventSource.mock.instances[0] as jest.Mocked<
        InstanceType<typeof EventSource>
      >;
      const errorListener = getEventSourceListener(instance, 'error');

      await act(async () => {
        errorListener({ data: '' });
      });

      expect(result.current.isReconnecting).toBe(true);
    });

    it('expone isReconnecting=false cuando el EventSource emite evento open tras error', async () => {
      const { result } = renderHook(() => useSSERequests(STORE_ID));

      await waitFor(() => {
        expect(MockEventSource).toHaveBeenCalledTimes(1);
      });

      const instance = MockEventSource.mock.instances[0] as jest.Mocked<
        InstanceType<typeof EventSource>
      >;
      const errorListener = getEventSourceListener(instance, 'error');
      const openListener = getEventSourceListener(instance, 'open');

      await act(async () => {
        errorListener({ data: '' });
      });
      expect(result.current.isReconnecting).toBe(true);

      await act(async () => {
        openListener({ data: '' });
      });
      expect(result.current.isReconnecting).toBe(false);
    });

    it('preserva el estado de requests durante la reconexión (no se limpia al recibir error)', async () => {
      const initial = [makePendingRequest('corr-preserved')];
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => initial,
      });

      const { result } = renderHook(() => useSSERequests(STORE_ID));

      await waitFor(() => {
        expect(result.current.requests).toHaveLength(1);
      });

      const instance = MockEventSource.mock.instances[0] as jest.Mocked<
        InstanceType<typeof EventSource>
      >;
      const errorListener = getEventSourceListener(instance, 'error');

      await act(async () => {
        errorListener({ data: '' });
      });

      // Las solicitudes previas deben mantenerse durante la reconexión
      expect(result.current.requests).toHaveLength(1);
      expect(result.current.requests[0].correlation_id).toBe('corr-preserved');
    });
  });
});
