import { useState, useEffect, useRef } from 'react';
import EventSource from 'react-native-sse';
import { PhysicalPresenceDispatchDto } from '@open-supervisor/shared-types';
import { bffClient } from '../api/bffClient';

interface UsePhysicalPresenceDispatchesResult {
  dispatches: PhysicalPresenceDispatchDto[];
  count: number;
}

export function usePhysicalPresenceDispatches(
  storeId: string,
): UsePhysicalPresenceDispatchesResult {
  const [dispatches, setDispatches] = useState<PhysicalPresenceDispatchDto[]>(
    [],
  );
  const esRef = useRef<InstanceType<typeof EventSource> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const es = new EventSource<'physical_presence_dispatch'>(
      `${bffClient.baseUrl}/stream/store/${storeId}`,
      { pollingInterval: 5000 },
    );
    esRef.current = es;

    es.addEventListener('physical_presence_dispatch', (event) => {
      if (cancelled || event.data == null) return;
      try {
        const dispatch: PhysicalPresenceDispatchDto = JSON.parse(event.data);
        if (!cancelled) {
          setDispatches((prev) => [...prev, dispatch]);
        }
      } catch {
        // silently ignore malformed events
      }
    });

    return () => {
      cancelled = true;
      if (esRef.current) {
        esRef.current.removeAllEventListeners();
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [storeId]);

  return { dispatches, count: dispatches.length };
}
