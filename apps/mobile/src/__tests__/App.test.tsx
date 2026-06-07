import React from 'react';
import { screen, waitFor } from '@testing-library/react-native';

// renderWithProvider is injected by jest.setup.js
declare const renderWithProvider: (ui: React.ReactElement, options?: any) => ReturnType<typeof import('@testing-library/react-native').render>;

// Mock AsyncStorage to return a valid token (authenticated session)
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue('fake-token'),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
  clear: jest.fn().mockResolvedValue(undefined),
}));

// Mock jwt-decode for token decoding
jest.mock('jwt-decode', () => ({
  jwtDecode: jest.fn().mockReturnValue({
    sub: 'supervisor-1',
    storeId: 'store-1',
    displayName: 'Juan Pérez',
    exp: Math.floor(Date.now() / 1000) + 28800,
  }),
}));

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
    it('pasa isRefreshingBackground a AuthorizationList cuando es true', async () => {
      mockUseSSERequests.mockReturnValue({
        requests: [sampleRequest],
        isLoading: false,
        isReconnecting: false,
        isRefreshingBackground: true,
        refetch: jest.fn().mockResolvedValue(undefined),
      });

      renderWithProvider(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('background-refresh-indicator')).toBeOnTheScreen();
      });
      expect(screen.getByTestId('card-corr-1')).toBeOnTheScreen();
    });

    it('pasa isRefreshingBackground a AuthorizationList cuando es false', async () => {
      mockUseSSERequests.mockReturnValue({
        requests: [sampleRequest],
        isLoading: false,
        isReconnecting: false,
        isRefreshingBackground: false,
        refetch: jest.fn().mockResolvedValue(undefined),
      });

      renderWithProvider(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('card-corr-1')).toBeOnTheScreen();
      });
      expect(screen.queryByTestId('background-refresh-indicator')).toBeNull();
    });
  });
});
