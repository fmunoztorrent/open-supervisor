import { useState, useEffect, useRef } from 'react';
import EventSource from 'react-native-sse';
import { AuthorizationRequestDto } from '@open-supervisor/shared-types';
import { bffClient } from '../api/bffClient';

export type RequestWithResolved = AuthorizationRequestDto & {
  resolved?: 'APPROVED' | 'REJECTED';
};

interface UseSSERequestsResult {
  requests: RequestWithResolved[];
  isLoading: boolean;
  isReconnecting: boolean;
}

export function useSSERequests(storeId: string): UseSSERequestsResult {
  const [requests, setRequests] = useState<RequestWithResolved[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const esRef = useRef<InstanceType<typeof EventSource> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      setIsLoading(true);
      try {
        const pending: AuthorizationRequestDto[] = await bffClient.get(
          `/authorization/store/${storeId}/pending`,
        );
        if (!cancelled) {
          setRequests(pending);
        }
      } catch {
        // silently handle; requests stays []
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }

      if (cancelled) return;

      const es = new EventSource<'authorization_request'>(
        `${bffClient.baseUrl}/stream/store/${storeId}`,
        { pollingInterval: 5000 },
      );
      esRef.current = es;

      es.addEventListener('authorization_request', (event) => {
        if (cancelled || event.data == null) return;
        try {
          const newRequest: RequestWithResolved = JSON.parse(event.data);
          setRequests(prev => [newRequest, ...prev]);
        } catch {
          // malformed JSON — skip
        }
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
      if (esRef.current) {
        esRef.current.removeAllEventListeners();
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [storeId]);

  return { requests, isLoading, isReconnecting };
}
