import { useState, useEffect, useRef, useCallback } from 'react';
import EventSource from 'react-native-sse';
import { AuthorizationRequestDto } from '@open-supervisor/shared-types';
import { bffClient } from '../api/bffClient';

export type RequestWithResolved = AuthorizationRequestDto & {
  resolved?: 'APPROVED' | 'REJECTED';
};

// BFF and SSE server return camelCase; normalize to the snake_case DTO contract.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRequest(raw: any): AuthorizationRequestDto {
  return {
    store_id: raw.store_id ?? raw.storeId,
    pos_id: raw.pos_id ?? raw.posId,
    correlation_id: raw.correlation_id ?? raw.correlationId,
    type: raw.type,
    created_at: raw.created_at ?? raw.createdAt,
    amount: raw.amount,
    employee_id: raw.employee_id ?? raw.employeeId,
    product_id: raw.product_id ?? raw.productId,
    original_price: raw.original_price ?? raw.originalPrice,
    requested_price: raw.requested_price ?? raw.requestedPrice,
  };
}

interface UseSSERequestsResult {
  requests: RequestWithResolved[];
  isLoading: boolean;
  isReconnecting: boolean;
  isRefreshingBackground: boolean;
  refetch: () => Promise<void>;
}

// Debounce window for background refresh (milliseconds)
const BACKGROUND_REFRESH_DEBOUNCE_MS = 2000;

export function useSSERequests(storeId: string): UseSSERequestsResult {
  const [requests, setRequests] = useState<RequestWithResolved[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isRefreshingBackground, setIsRefreshingBackground] = useState(false);
  const esRef = useRef<InstanceType<typeof EventSource> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadDoneRef = useRef(false);

  // Memoized fetch of pending requests from BFF.
  // Used both for initial load and for refetch after decision.
  const fetchPending = useCallback(
    async (showBackgroundRefresh: boolean): Promise<RequestWithResolved[]> => {
      if (showBackgroundRefresh) {
        setIsRefreshingBackground(true);
      }
      try {
        const raw: unknown[] = await bffClient.get(
          `/authorization/store/${storeId}/pending`,
        );
        const normalized = raw.map(normalizeRequest);
        setRequests(normalized);
        return normalized;
      } catch {
        return requests; // keep current state on failure
      } finally {
        if (showBackgroundRefresh) {
          setIsRefreshingBackground(false);
        }
      }
    },
    [storeId], // eslint-disable-line react-hooks/exhaustive-deps -- requests is read but used only in catch
  );

  // Public refetch — triggers a silent GET /pending and updates the list.
  // Called after a decision ensures the resolved request disappears immediately.
  const refetch = useCallback(async () => {
    await fetchPending(false);
  }, [fetchPending]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      setIsLoading(true);
      await fetchPending(false);
      if (!cancelled) {
        setIsLoading(false);
        initialLoadDoneRef.current = true;
      }

      if (cancelled) return;

      const es = new EventSource<'authorization_request'>(
        `${bffClient.baseUrl}/stream/store/${storeId}`,
        { pollingInterval: 5000 },
      );
      esRef.current = es;

      es.addEventListener('authorization_request', (event) => {
        if (cancelled || event.data == null) return;

        // Only trigger background refresh if initial load is complete
        if (!initialLoadDoneRef.current) return;

        setIsRefreshingBackground(true);

        // Debounce: cancel any pending refetch and schedule a new one
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
        }

        debounceRef.current = setTimeout(async () => {
          try {
            const raw: unknown[] = await bffClient.get(
              `/authorization/store/${storeId}/pending`,
            );
            if (!cancelled) {
              setRequests(raw.map(normalizeRequest));
            }
          } catch {
            // silently fail — keep current requests
          } finally {
            if (!cancelled) {
              setIsRefreshingBackground(false);
            }
          }
        }, BACKGROUND_REFRESH_DEBOUNCE_MS);
      });

      es.addEventListener('error', () => {
        if (!cancelled) {
          setIsReconnecting(true);
        }
      });

      es.addEventListener('open', () => {
        if (!cancelled) {
          setIsReconnecting(false);
        }
      });
    };

    init();

    return () => {
      cancelled = true;

      // Clear debounce timer
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      // Close SSE connection
      if (esRef.current) {
        esRef.current.removeAllEventListeners();
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [storeId, fetchPending]);

  return { requests, isLoading, isReconnecting, isRefreshingBackground, refetch };
}
