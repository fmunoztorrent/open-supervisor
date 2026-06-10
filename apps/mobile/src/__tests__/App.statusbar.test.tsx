import React from 'react';
import { screen } from '@testing-library/react-native';
import { StatusBar } from 'react-native';

// renderWithProvider is injected by jest.setup.js
declare const renderWithProvider: (ui: React.ReactElement, options?: any) => ReturnType<typeof import('@testing-library/react-native').render>;

const mockUseSSERequests = jest.fn();
jest.mock('../hooks/useSSERequests', () => ({
  useSSERequests: (...args: unknown[]) => mockUseSSERequests(...args),
}));

jest.mock('../hooks/usePhysicalPresenceDispatches', () => ({
  usePhysicalPresenceDispatches: () => ({ dispatches: [], count: 0 }),
}));

jest.mock('../hooks/useLogout', () => ({
  useLogout: () => ({ logout: jest.fn() }),
}));

jest.mock('../components/AuthorizationList', () => ({
  AuthorizationList: () => null,
}));

import App from '../../App';

describe('App — safe area / status bar', () => {
  const STATUS_BAR_HEIGHT = 24;

  beforeEach(() => {
    jest.clearAllMocks();
    // Simula la altura de la barra de estado de Android
    (StatusBar as unknown as { currentHeight: number }).currentHeight = STATUS_BAR_HEIGHT;
    mockUseSSERequests.mockReturnValue({
      requests: [],
      isLoading: false,
      isReconnecting: false,
      isRefreshingBackground: false,
      refetch: jest.fn().mockResolvedValue(undefined),
    });
  });

  it('aplica paddingTop = StatusBar.currentHeight al contenedor para no solapar la status bar', () => {
    renderWithProvider(<App />);

    const safeArea = screen.getByTestId('app-safe-area');
    expect(safeArea).toHaveStyle({ paddingTop: STATUS_BAR_HEIGHT });
  });
});
