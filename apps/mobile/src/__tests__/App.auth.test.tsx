import React from 'react';
import { screen, waitFor } from '@testing-library/react-native';

// renderWithProvider is injected by jest.setup.js
declare const renderWithProvider: (ui: React.ReactElement, options?: any) => ReturnType<typeof import('@testing-library/react-native').render>;

const mockGetItem = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (...args: unknown[]) => mockGetItem(...args),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
  clear: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('jwt-decode', () => ({
  jwtDecode: jest.fn().mockReturnValue({
    sub: 'supervisor-1',
    storeId: 'store-1',
    displayName: 'Juan Pérez',
    exp: Math.floor(Date.now() / 1000) + 28800,
  }),
}));

jest.mock('../hooks/useSSERequests', () => ({
  useSSERequests: () => ({
    requests: [],
    isLoading: false,
    isReconnecting: false,
    isRefreshingBackground: false,
    refetch: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('../hooks/usePhysicalPresenceDispatches', () => ({
  usePhysicalPresenceDispatches: () => ({ dispatches: [], count: 0 }),
}));

jest.mock('../components/AuthorizationList', () => ({
  AuthorizationList: () => null,
}));

import App from '../../App';

describe('App — gate de autenticación', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('muestra LoginScreen cuando NO hay token almacenado', async () => {
    mockGetItem.mockResolvedValue(null);

    renderWithProvider(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('login-title')).toBeOnTheScreen();
    });
    expect(screen.queryByTestId('app-safe-area')).toBeNull();
  });

  it('muestra la app (header) cuando hay un token válido', async () => {
    mockGetItem.mockResolvedValue('valid-token');

    renderWithProvider(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('app-safe-area')).toBeOnTheScreen();
    });
    expect(screen.queryByTestId('login-title')).toBeNull();
  });
});
