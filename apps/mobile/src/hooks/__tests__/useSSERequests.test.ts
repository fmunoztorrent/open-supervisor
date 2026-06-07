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
  });

  describe('background refresh al recibir SSE (US-01)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('NO hace prepend directo — dispara refetch GET /pending cuando llega authorization_request', async () => {
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

      // NO debe haber prepend directo — los datos actuales se mantienen
      expect(result.current.requests).toHaveLength(1);
      expect(result.current.requests[0].correlation_id).toBe('corr-existing');

      // isRefreshingBackground se activa inmediatamente
      expect(result.current.isRefreshingBackground).toBe(true);

      // Avanzamos timers para que el debounce se cumpla
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [newRequest, ...initial],
      });

      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      await waitFor(() => {
        expect(result.current.requests).toHaveLength(2);
      });

      // Los datos se actualizan con la respuesta del servidor
      expect(result.current.requests[0].correlation_id).toBe('corr-new');

      // isRefreshingBackground vuelve a false
      expect(result.current.isRefreshingBackground).toBe(false);
    });

    it('isRefreshingBackground se activa durante refetch y se desactiva al completar', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [makePendingRequest('corr-1')],
      });

      const { result } = renderHook(() => useSSERequests(STORE_ID));

      await waitFor(() => {
        expect(result.current.requests).toHaveLength(1);
      });

      const instance = MockEventSource.mock.instances[0] as jest.Mocked<
        InstanceType<typeof EventSource>
      >;
      const listener = getEventSourceListener(instance, 'authorization_request');

      // Estado inicial
      expect(result.current.isRefreshingBackground).toBe(false);

      await act(async () => {
        listener({ data: JSON.stringify(makePendingRequest('corr-2')) });
      });

      // Se activa inmediatamente
      expect(result.current.isRefreshingBackground).toBe(true);

      // Simular respuesta del refetch
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [makePendingRequest('corr-2'), makePendingRequest('corr-1')],
      });

      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      await waitFor(() => {
        expect(result.current.isRefreshingBackground).toBe(false);
      });
    });

    it('refetch fallido mantiene datos actuales y oculta el indicador', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [makePendingRequest('corr-1')],
      });

      const { result } = renderHook(() => useSSERequests(STORE_ID));

      await waitFor(() => {
        expect(result.current.requests).toHaveLength(1);
      });

      const instance = MockEventSource.mock.instances[0] as jest.Mocked<
        InstanceType<typeof EventSource>
      >;
      const listener = getEventSourceListener(instance, 'authorization_request');

      await act(async () => {
        listener({ data: JSON.stringify(makePendingRequest('corr-2')) });
      });

      expect(result.current.isRefreshingBackground).toBe(true);

      // El refetch falla
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      // Debe esperar a que la promesa se resuelva (rechazada)
      await waitFor(() => {
        expect(result.current.isRefreshingBackground).toBe(false);
      });

      // Los datos originales se mantienen
      expect(result.current.requests).toHaveLength(1);
      expect(result.current.requests[0].correlation_id).toBe('corr-1');
    });

    it('debounce de 2s: múltiples SSE consecutivos disparan solo un refetch', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [makePendingRequest('corr-1')],
      });

      renderHook(() => useSSERequests(STORE_ID));

      await waitFor(() => {
        expect(MockEventSource).toHaveBeenCalledTimes(1);
      });

      const instance = MockEventSource.mock.instances[0] as jest.Mocked<
        InstanceType<typeof EventSource>
      >;
      const listener = getEventSourceListener(instance, 'authorization_request');

      // Limpiar contador de fetch para ignorar la llamada inicial
      (global.fetch as jest.Mock).mockClear();
      // Mock para el refetch
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [makePendingRequest('corr-4')],
      });

      // 3 eventos SSE en rápida sucesión — dentro de act
      await act(async () => {
        listener({ data: JSON.stringify(makePendingRequest('corr-2')) });
        jest.advanceTimersByTime(500);
        listener({ data: JSON.stringify(makePendingRequest('corr-3')) });
        jest.advanceTimersByTime(500);
        listener({ data: JSON.stringify(makePendingRequest('corr-4')) });
        // Avanzar más allá del debounce de 2s para que se ejecute el timer
        jest.advanceTimersByTime(2000);
      });

      // Solo debería haber 1 llamado a fetch (el debounce reinicia cada vez)
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });
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

    it('limpia el timeout del debounce al desmontar', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [makePendingRequest('corr-1')],
      });

      const { result, unmount } = renderHook(() => useSSERequests(STORE_ID));

      await waitFor(() => {
        expect(result.current.requests).toHaveLength(1);
      });

      const instance = MockEventSource.mock.instances[0] as jest.Mocked<
        InstanceType<typeof EventSource>
      >;
      const listener = getEventSourceListener(instance, 'authorization_request');

      await act(async () => {
        listener({ data: JSON.stringify(makePendingRequest('corr-2')) });
      });

      // Desmontar mientras hay un refetch pendiente — no debe haber errores
      expect(result.current.isRefreshingBackground).toBe(true);
      unmount();

      // No debe haber excepciones — el cleanup del timeout funciona
    });
  });

  describe('refetch post-decisión (bugfix: request no desaparece tras autorizar/rechazar)', () => {
    it('expone una función refetch que actualiza la lista con los datos del servidor', async () => {
      // Carga inicial: 2 solicitudes pendientes
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [
          makePendingRequest('corr-1'),
          makePendingRequest('corr-2'),
        ],
      });

      const { result } = renderHook(() => useSSERequests(STORE_ID));

      await waitFor(() => {
        expect(result.current.requests).toHaveLength(2);
      });

      // Verificar que refetch existe como función
      expect(typeof result.current.refetch).toBe('function');

      // Simular que corr-2 fue resuelta → el backend ya no la devuelve
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [makePendingRequest('corr-1')],
      });

      // Ejecutar refetch
      await act(async () => {
        await result.current.refetch();
      });

      // La solicitud resuelta (corr-2) debe desaparecer de la lista
      expect(result.current.requests).toHaveLength(1);
      expect(result.current.requests[0].correlation_id).toBe('corr-1');
    });

    it('refetch no afecta isLoading (solo es para refresh post-decisión)', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [makePendingRequest('corr-1')],
      });

      const { result } = renderHook(() => useSSERequests(STORE_ID));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await act(async () => {
        await result.current.refetch();
      });

      // isLoading debe permanecer false — refetch es un refresh silencioso
      expect(result.current.isLoading).toBe(false);
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
