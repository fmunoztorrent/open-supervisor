import { useState, useEffect, useCallback, useRef } from 'react';
import { AuthorizationRequestDto } from '@open-supervisor/shared-types';
import { bffClient } from '../api/bffClient';
import { useSession } from '../context/SessionContext';

export type StatusFilter = 'ALL' | 'APPROVED' | 'REJECTED';

interface UseRequestHistoryResult {
  requests: AuthorizationRequestDto[];
  isLoading: boolean;
  error: string | null;
  statusFilter: StatusFilter;
  setStatusFilter: (f: StatusFilter) => void;
  refetch: () => void;
}

export function useRequestHistory(storeId: string, supervisorIdParam?: string): UseRequestHistoryResult {
  const { supervisorId: contextSupervisorId } = useSession();
  const supervisorId = supervisorIdParam || contextSupervisorId || undefined;

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
        if (supervisorId) {
          params.set('supervisorId', supervisorId);
        }
        if (statusFilter !== 'ALL') {
          params.set('status', statusFilter);
        }
        const data: any[] = await bffClient.get(
          `/authorization/requests/history?${params.toString()}`,
        );
        // Normalize status → resolved for AuthorizationCard compatibility
        const normalized = data.map((item: any) => ({
          ...item,
          resolved: item.status === 'APPROVED'
            ? 'APPROVED'
            : item.status === 'REJECTED'
            ? 'REJECTED'
            : undefined,
        }));
        if (!controller.signal.aborted && fetchId === fetchIdRef.current) {
          setRequests(normalized);
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
    [storeId, supervisorId, statusFilter],
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
