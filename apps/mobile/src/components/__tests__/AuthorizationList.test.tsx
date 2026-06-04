import React from 'react';
import { screen } from '@testing-library/react-native';
import { AuthorizationRequestDto, RequestType } from '@open-supervisor/shared-types';

// renderWithProvider is injected by jest.setup.js
declare const renderWithProvider: (ui: React.ReactElement, options?: any) => ReturnType<typeof import('@testing-library/react-native').render>;

// Este import fallará con "Cannot find module" hasta que el componente sea implementado.
import { AuthorizationList } from '../AuthorizationList';

// Mockeamos AuthorizationCard para aislar AuthorizationList.
// Como el componente no existe aún, este mock también fallará, pero el error
// primario será el de AuthorizationList — que es el correcto.
jest.mock('../AuthorizationCard', () => ({
  AuthorizationCard: ({ request }: { request: AuthorizationRequestDto }) => {
    const { Text } = require('react-native');
    return <Text testID={`card-${request.correlation_id}`}>{request.correlation_id}</Text>;
  },
}));

const makeRequest = (correlationId: string): AuthorizationRequestDto => ({
  store_id: 'store-42',
  pos_id: 'pos-1',
  correlation_id: correlationId,
  type: RequestType.DISCOUNT,
  created_at: '2026-06-03T10:30:00.000Z',
});

describe('AuthorizationList', () => {
  describe('estado vacío', () => {
    it('muestra "Sin solicitudes pendientes" cuando requests es []', () => {
      renderWithProvider(
        <AuthorizationList requests={[]} onPressRequest={jest.fn()} />,
      );
      expect(screen.getByText('Sin solicitudes pendientes')).toBeOnTheScreen();
    });

    it('no renderiza ninguna card cuando requests es []', () => {
      renderWithProvider(
        <AuthorizationList requests={[]} onPressRequest={jest.fn()} />,
      );
      expect(screen.queryByTestId(/^card-/)).toBeNull();
    });
  });

  describe('renderizado de cards', () => {
    it('renderiza N cards cuando requests tiene N elementos', () => {
      const requests = [
        makeRequest('corr-1'),
        makeRequest('corr-2'),
        makeRequest('corr-3'),
      ];
      renderWithProvider(
        <AuthorizationList requests={requests} onPressRequest={jest.fn()} />,
      );
      expect(screen.getByTestId('card-corr-1')).toBeOnTheScreen();
      expect(screen.getByTestId('card-corr-2')).toBeOnTheScreen();
      expect(screen.getByTestId('card-corr-3')).toBeOnTheScreen();
    });

    it('no muestra el mensaje de estado vacío cuando hay requests', () => {
      const requests = [makeRequest('corr-1')];
      renderWithProvider(
        <AuthorizationList requests={requests} onPressRequest={jest.fn()} />,
      );
      expect(screen.queryByText('Sin solicitudes pendientes')).toBeNull();
    });

    it('la primera card en pantalla corresponde al primer elemento del array', () => {
      const requests = [makeRequest('corr-first'), makeRequest('corr-second')];
      renderWithProvider(
        <AuthorizationList requests={requests} onPressRequest={jest.fn()} />,
      );
      const cards = screen.queryAllByTestId(/^card-/);
      // El primer elemento renderizado debe corresponder al primer request del array.
      expect(cards[0].props.testID).toBe('card-corr-first');
    });
  });

  describe('estado de carga', () => {
    it('muestra Spinner de Gluestack cuando isLoading es true', () => {
      // FASE RED: este test DEBE FALLAR porque el componente actual renderiza
      // <Text>Cargando...</Text>, no un Spinner de Gluestack con testID 'list-spinner'.
      // El frontend debe reemplazar el Text por el componente Spinner de @gluestack-ui/themed
      // y asignarle testID='list-spinner' para que este test pase.
      renderWithProvider(
        <AuthorizationList requests={[]} onPressRequest={() => {}} isLoading={true} />,
      );
      expect(screen.getByTestId('list-spinner')).toBeTruthy();
    });
  });
});
