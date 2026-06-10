import { useState, useEffect, useCallback, useRef } from 'react';
import { AuthorizationRequestDto } from '@open-supervisor/shared-types';
import { bffClient } from '../api/bffClient';

export type StatusFilter = 'ALL' | 'APPROVED' | 'REJECTED';

interface UseRequestHistoryResult {
  requests: AuthorizationRequestDto[];
  isLoading: boolean;
  error: string | null;
  statusFilter: StatusFilter;
  setStatusFilter: (f: StatusFilter) => void;
  refetch: () => void;
}

export function useRequestHistory(storeId: string): UseRequestHistoryResult {
  const [requests, setRequests] = useState<AuthorizationRequestDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const abortRef = useRef<AbortController | null>(null);
  const fetchIdRef = useRef(0);

  const fetchHistory = useCallback(
    async (fetchId: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ storeId });
        if (statusFilter !== 'ALL') {
          params.set('status', statusFilter);
        }
        const data: AuthorizationRequestDto[] = await bffClient.get(
          `/api/requests/history?${params.toString()}`,
        );
        if (!controller.signal.aborted && fetchId === fetchIdRef.current) {
          setRequests(data);
          setIsLoading(false);
        }
      } catch (err) {
        if (!controller.signal.aborted && fetchId === fetchIdRef.current) {
          const message =
            err instanceof Error
              ? err.message
              : 'Error al cargar el historial';
          setError(message);
          setIsLoading(false);
        }
      }
    },
    [storeId, statusFilter],
  );

  const refetch = useCallback(() => {
    fetchIdRef.current += 1;
    fetchHistory(fetchIdRef.current);
  }, [fetchHistory]);

  useEffect(() => {
    fetchIdRef.current += 1;
    fetchHistory(fetchIdRef.current);

    return () => {
      abortRef.current?.abort();
    };
  }, [fetchHistory]);

  return { requests, isLoading, error, statusFilter, setStatusFilter, refetch };
}
