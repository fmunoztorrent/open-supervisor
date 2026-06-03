import { renderHook, act, waitFor } from '@testing-library/react-native';

// Este import fallará con "Cannot find module" hasta que el hook sea implementado.
import { useDecision } from '../useDecision';

const CORRELATION_ID = 'corr-99';
const SUPERVISOR_ID = 'sup-1';

describe('useDecision', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('estado inicial', () => {
    it('expone isLoading=false y error=null en el estado inicial', () => {
      // El hook no hace ninguna llamada en el montaje; no necesita fetch mockeado.
      const { result } = renderHook(() =>
        useDecision(CORRELATION_ID, SUPERVISOR_ID),
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('decide APPROVE', () => {
    it('hace POST a /authorization/:correlationId/resolve con decision APPROVE y supervisor_id', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const { result } = renderHook(() =>
        useDecision(CORRELATION_ID, SUPERVISOR_ID),
      );

      await act(async () => {
        await result.current.decide('APPROVE');
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/authorization/${CORRELATION_ID}/resolve`),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ decision: 'APPROVE', supervisor_id: SUPERVISOR_ID }),
        }),
      );
    });

    it('establece isLoading=true mientras el POST está en vuelo', async () => {
      let resolveFetch!: (value: unknown) => void;
      (global.fetch as jest.Mock).mockReturnValueOnce(
        new Promise(resolve => {
          resolveFetch = resolve;
        }),
      );

      const { result } = renderHook(() =>
        useDecision(CORRELATION_ID, SUPERVISOR_ID),
      );

      // Lanzamos la decisión sin await para capturar el estado intermedio.
      act(() => {
        result.current.decide('APPROVE');
      });

      // En el siguiente tick isLoading debe ser true
      await waitFor(() => {
        expect(result.current.isLoading).toBe(true);
      });

      // Resolvemos el fetch para que el hook finalice y no haya act() pendiente
      await act(async () => {
        resolveFetch({ ok: true, json: async () => ({}) });
      });
    });

    it('establece isLoading=false y error=null tras respuesta exitosa', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const { result } = renderHook(() =>
        useDecision(CORRELATION_ID, SUPERVISOR_ID),
      );

      await act(async () => {
        await result.current.decide('APPROVE');
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('decide REJECT', () => {
    it('hace POST con decision REJECT y supervisor_id', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const { result } = renderHook(() =>
        useDecision(CORRELATION_ID, SUPERVISOR_ID),
      );

      await act(async () => {
        await result.current.decide('REJECT');
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/authorization/${CORRELATION_ID}/resolve`),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ decision: 'REJECT', supervisor_id: SUPERVISOR_ID }),
        }),
      );
    });
  });

  describe('manejo de error', () => {
    it('establece isLoading=false y error con mensaje tras respuesta non-2xx', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      const { result } = renderHook(() =>
        useDecision(CORRELATION_ID, SUPERVISOR_ID),
      );

      await act(async () => {
        await result.current.decide('APPROVE');
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).not.toBeNull();
      expect(typeof result.current.error).toBe('string');
    });

    it('establece error cuando fetch rechaza (error de red)', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() =>
        useDecision(CORRELATION_ID, SUPERVISOR_ID),
      );

      await act(async () => {
        await result.current.decide('APPROVE');
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).not.toBeNull();
    });
  });
});
