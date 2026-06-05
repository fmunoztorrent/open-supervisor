import React from 'react';
import { screen } from '@testing-library/react-native';

// renderWithProvider is injected by jest.setup.js
declare const renderWithProvider: (ui: React.ReactElement, options?: any) => ReturnType<typeof import('@testing-library/react-native').render>;

// Mock useSSERequests to control its return value
const mockUseSSERequests = jest.fn();
jest.mock('../hooks/useSSERequests', () => ({
  useSSERequests: (...args: unknown[]) => mockUseSSERequests(...args),
}));

// Mock useDecision (used by DetailView, not rendered in initial state)
jest.mock('../hooks/useDecision', () => ({
  useDecision: jest.fn().mockReturnValue({
    decide: jest.fn(),
    isLoading: false,
    error: null,
  }),
}));

// Mock AuthorizationCard to simplify rendering in test
jest.mock('../components/AuthorizationCard', () => ({
  AuthorizationCard: ({ request, onPress }: { request: { correlation_id: string }; onPress: () => void }) => {
    const { Text, TouchableOpacity } = require('react-native');
    return (
      <TouchableOpacity onPress={onPress} testID={`card-${request.correlation_id}`}>
        <Text>{request.correlation_id}</Text>
      </TouchableOpacity>
    );
  },
}));

import App from '../../App';

const sampleRequest = {
  store_id: 'store-1',
  pos_id: 'pos-1',
  correlation_id: 'corr-1',
  type: 'DISCOUNT',
  created_at: '2026-06-03T10:30:00.000Z',
};

describe('App', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('indicador de background refresh (wiring)', () => {
    it('pasa isRefreshingBackground a AuthorizationList cuando es true', () => {
      mockUseSSERequests.mockReturnValue({
        requests: [sampleRequest],
        isLoading: false,
        isReconnecting: false,
        isRefreshingBackground: true,
        refetch: jest.fn().mockResolvedValue(undefined),
      });

      renderWithProvider(<App />);

      expect(screen.getByTestId('background-refresh-indicator')).toBeOnTheScreen();
      expect(screen.getByTestId('card-corr-1')).toBeOnTheScreen();
    });

    it('pasa isRefreshingBackground a AuthorizationList cuando es false', () => {
      mockUseSSERequests.mockReturnValue({
        requests: [sampleRequest],
        isLoading: false,
        isReconnecting: false,
        isRefreshingBackground: false,
        refetch: jest.fn().mockResolvedValue(undefined),
      });

      renderWithProvider(<App />);

      expect(screen.queryByTestId('background-refresh-indicator')).toBeNull();
      expect(screen.getByTestId('card-corr-1')).toBeOnTheScreen();
    });
  });
});
