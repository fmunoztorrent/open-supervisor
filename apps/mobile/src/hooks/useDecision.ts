import { useState, useCallback } from 'react';
import { bffClient } from '../api/bffClient';

interface UseDecisionResult {
  decide: (decision: 'APPROVE' | 'REJECT') => Promise<boolean>;
  isLoading: boolean;
  error: string | null;
}

export function useDecision(
  correlationId: string,
  supervisorId: string,
): UseDecisionResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = useCallback(
    async (decision: 'APPROVE' | 'REJECT'): Promise<boolean> => {
      setIsLoading(true);
      setError(null);
      try {
        await bffClient.post(`/authorization/${correlationId}/resolve`, {
          decision,
          supervisor_id: supervisorId,
        });
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Error al enviar la decisión';
        setError(message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [correlationId, supervisorId],
  );

  return { decide, isLoading, error };
}
