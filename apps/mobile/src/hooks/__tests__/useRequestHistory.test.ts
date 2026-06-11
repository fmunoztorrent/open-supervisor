import { renderHook, act, waitFor } from '@testing-library/react-native';
import { AuthorizationRequestDto, RequestType } from '@open-supervisor/shared-types';

// Este import fallará con "Cannot find module" hasta que el hook sea implementado.
import { useRequestHistory, StatusFilter } from '../useRequestHistory';

const STORE_ID = 'store-42';

const makeHistoryItem = (
  correlationId: string,
  status: string,
): AuthorizationRequestDto & { status: string } => ({
  store_id: STORE_ID,
  pos_id: 'pos-1',
  correlation_id: correlationId,
  type: RequestType.DISCOUNT,
  created_at: '2026-06-10T10:00:00.000Z',
  // El backend retorna 'status' pero el hook debe normalizarlo a 'resolved'
  status,
});

describe('useRequestHistory', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── US-04: Corrección de URL ────────────────────────────────────────────
  describe('URL del endpoint (US-04)', () => {
    it('llama a /authorization/requests/history (no a /api/requests/history) — FASE RED', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      renderHook(() => useRequestHistory(STORE_ID));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      const url = (global.fetch as jest.Mock).mock.calls[0][0];
      // ← FALLA: la URL actual es /api/requests/history
      expect(url).toContain('/authorization/requests/history');
      expect(url).not.toContain('/api/requests/history');
    });

    it('no depende de rewrites ni proxies en la URL', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      renderHook(() => useRequestHistory(STORE_ID));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      const url = (global.fetch as jest.Mock).mock.calls[0][0];
      // La URL debe empezar desde la ruta esperada, no desde /api
      expect(url).toMatch(/\/authorization\/requests\/history/);
    });
  });

  // ─── US-01: Filtro por supervisor ────────────────────────────────────────
  describe('parámetros de consulta (US-01)', () => {
    it('envía storeId como query param', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      renderHook(() => useRequestHistory(STORE_ID));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      const url = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(url).toContain(`storeId=${STORE_ID}`);
    });

    // FASE RED — el hook actual no acepta supervisorId ni lo envía
    it('envía supervisorId cuando se proporciona (FASE RED — DEBE FALLAR)', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      renderHook(() => useRequestHistory(STORE_ID, 'supervisor-A'));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      const url = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(url).toContain('supervisorId=supervisor-A');
    });

    it('envía status filter cuando no es ALL', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => [] }) // initial load
        .mockResolvedValueOnce({ ok: true, json: async () => [] }); // after filter change

      const { result } = renderHook(() => useRequestHistory(STORE_ID));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        result.current.setStatusFilter('APPROVED');
      });

      await waitFor(() => {
        const calls = (global.fetch as jest.Mock).mock.calls;
        const lastUrl = calls[calls.length - 1]?.[0];
        expect(lastUrl).toContain('status=APPROVED');
      });
    });

    it('NO envía status cuando el filtro es ALL', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      renderHook(() => useRequestHistory(STORE_ID));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      const url = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(url).not.toContain('status=');
    });
  });

  // ─── Flag #1: Normalización status → resolved ────────────────────────────
  describe('normalización status → resolved (Flag #1)', () => {
    it('normaliza el campo status del backend a resolved en los items retornados', async () => {
      const backendItems = [
        makeHistoryItem('corr-1', 'APPROVED'),
        makeHistoryItem('corr-2', 'REJECTED'),
      ];
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => backendItems,
      });

      const { result } = renderHook(() => useRequestHistory(STORE_ID));

      await waitFor(() => {
        expect(result.current.requests).toHaveLength(2);
      });

      // ← FASE RED: el hook actual no normaliza status → resolved.
      // AuthorizationCard usa request.resolved para mostrar el badge.
      // Sin normalización, todas las solicitudes del historial muestran "Pendiente".
      const resolvedValues = result.current.requests.map((r: any) => r.resolved);
      expect(resolvedValues).toEqual(['APPROVED', 'REJECTED']);
    });

    it('items normalizados muestran el badge correcto en AuthorizationCard', async () => {
      const backendItems = [
        makeHistoryItem('corr-3', 'APPROVED'),
      ];
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => backendItems,
      });

      const { result } = renderHook(() => useRequestHistory(STORE_ID));

      await waitFor(() => {
        expect(result.current.requests).toHaveLength(1);
      });

      const item = result.current.requests[0] as any;
      // El campo 'resolved' es lo que AuthorizationCard usa para el badge
      expect(item.resolved).toBe('APPROVED');
      // El campo 'status' original también debe estar disponible
      expect(item.status).toBe('APPROVED');
    });
  });

  // ─── Estados de UI ───────────────────────────────────────────────────────
  describe('estados de UI', () => {
    it('expone isLoading=true durante la carga inicial', async () => {
      let resolveFetch!: (value: unknown) => void;
      (global.fetch as jest.Mock).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      );

      const { result } = renderHook(() => useRequestHistory(STORE_ID));

      // isLoading debe ser true mientras el fetch está pendiente
      expect(result.current.isLoading).toBe(true);

      // Limpiar
      await act(async () => {
        resolveFetch({ ok: true, json: async () => [] });
      });
    });

    it('expone isLoading=false y requests poblado tras carga exitosa', async () => {
      const items = [makeHistoryItem('corr-1', 'APPROVED')];
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => items,
      });

      const { result } = renderHook(() => useRequestHistory(STORE_ID));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      expect(result.current.requests).toHaveLength(1);
      expect(result.current.error).toBeNull();
    });

    it('expone error cuando el fetch falla', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network error'),
      );

      const { result } = renderHook(() => useRequestHistory(STORE_ID));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      expect(result.current.error).not.toBeNull();
      expect(result.current.requests).toEqual([]);
    });

    it('expone statusFilter inicial como ALL', () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const { result } = renderHook(() => useRequestHistory(STORE_ID));

      expect(result.current.statusFilter).toBe('ALL');
    });

    it('refetch vuelve a cargar los datos', async () => {
      const initialItems = [makeHistoryItem('corr-1', 'APPROVED')];
      const updatedItems = [
        makeHistoryItem('corr-1', 'APPROVED'),
        makeHistoryItem('corr-2', 'REJECTED'),
      ];
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => initialItems })
        .mockResolvedValueOnce({ ok: true, json: async () => updatedItems });

      const { result } = renderHook(() => useRequestHistory(STORE_ID));

      await waitFor(() => {
        expect(result.current.requests).toHaveLength(1);
      });

      await act(async () => {
        result.current.refetch();
      });

      await waitFor(() => {
        expect(result.current.requests).toHaveLength(2);
      });
    });
  });

  // ─── AbortController cleanup ─────────────────────────────────────────────
  describe('AbortController cleanup', () => {
    it('aborta el fetch pendiente al desmontar', async () => {
      let abortCalled = false;
      const originalAbort = AbortController.prototype.abort;
      AbortController.prototype.abort = function () {
        abortCalled = true;
        return originalAbort.call(this);
      };

      (global.fetch as jest.Mock).mockReturnValueOnce(
        new Promise(() => {}), // never resolves
      );

      const { unmount } = renderHook(() => useRequestHistory(STORE_ID));

      unmount();

      expect(abortCalled).toBe(true);

      // Restaurar
      AbortController.prototype.abort = originalAbort;
    });

    it('aborta fetch previo cuando cambia el filtro de status', async () => {
      let abortCount = 0;
      const originalAbort = AbortController.prototype.abort;
      AbortController.prototype.abort = function () {
        abortCount++;
        return originalAbort.call(this);
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: true, json: async () => [] })
        .mockResolvedValueOnce({ ok: true, json: async () => [] });

      const { result } = renderHook(() => useRequestHistory(STORE_ID));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Cambiar filtro — debe abortar el fetch anterior
      await act(async () => {
        result.current.setStatusFilter('APPROVED');
      });

      // Se llama a abort al cambiar el filtro (el fetch anterior se aborta)
      expect(abortCount).toBeGreaterThanOrEqual(1);

      AbortController.prototype.abort = originalAbort;
    });
  });
});
