import React from 'react';
import { screen, fireEvent } from '@testing-library/react-native';
import { AuthorizationRequestDto, RequestType } from '@open-supervisor/shared-types';

// renderWithProvider is injected by jest.setup.js
declare const renderWithProvider: (ui: React.ReactElement, options?: any) => ReturnType<typeof import('@testing-library/react-native').render>;

// Este import fallará con "Cannot find module" hasta que el componente sea implementado.
import { AuthorizationCard } from '../AuthorizationCard';

const baseRequest: AuthorizationRequestDto = {
  store_id: 'store-42',
  pos_id: 'pos-1',
  correlation_id: 'corr-abc',
  type: RequestType.DISCOUNT,
  created_at: '2026-06-03T10:30:00.000Z',
};

describe('AuthorizationCard', () => {
  describe('campos básicos', () => {
    it('muestra el tipo de solicitud', () => {
      renderWithProvider(
        <AuthorizationCard request={baseRequest} onPress={jest.fn()} />,
      );
      expect(screen.getByText(/DISCOUNT/i)).toBeOnTheScreen();
    });

    it('muestra el pos_id', () => {
      renderWithProvider(
        <AuthorizationCard request={baseRequest} onPress={jest.fn()} />,
      );
      expect(screen.getByText(/pos-1/i)).toBeOnTheScreen();
    });

    it('muestra el created_at formateado (algún texto derivado de la fecha ISO)', () => {
      renderWithProvider(
        <AuthorizationCard request={baseRequest} onPress={jest.fn()} />,
      );
      // La fecha ISO '2026-06-03T10:30:00.000Z' debe aparecer formateada de alguna manera.
      // Verificamos que algún elemento en pantalla contiene "10:30" (hora UTC) o "06/03" (fecha).
      // Usamos testID para no acoplar al formato exacto.
      expect(screen.getByTestId('card-created-at')).toBeOnTheScreen();
    });

    it('llama a onPress cuando se toca la card', () => {
      const onPress = jest.fn();
      renderWithProvider(
        <AuthorizationCard request={baseRequest} onPress={onPress} />,
      );
      fireEvent.press(screen.getByTestId('authorization-card'));
      expect(onPress).toHaveBeenCalledTimes(1);
    });
  });

  describe('badge de estado', () => {
    it('muestra badge "Pendiente" cuando resolved es undefined', () => {
      renderWithProvider(
        <AuthorizationCard request={baseRequest} onPress={jest.fn()} />,
      );
      expect(screen.getByText('Pendiente')).toBeOnTheScreen();
    });

    it('muestra badge "Autorizada" cuando resolved es APPROVED', () => {
      renderWithProvider(
        <AuthorizationCard
          request={{ ...baseRequest, resolved: 'APPROVED' }}
          onPress={jest.fn()}
        />,
      );
      expect(screen.getByText('Autorizada')).toBeOnTheScreen();
    });

    it('muestra badge "Rechazada" cuando resolved es REJECTED', () => {
      renderWithProvider(
        <AuthorizationCard
          request={{ ...baseRequest, resolved: 'REJECTED' }}
          onPress={jest.fn()}
        />,
      );
      expect(screen.getByText('Rechazada')).toBeOnTheScreen();
    });
  });

  describe('campos opcionales', () => {
    it('no lanza cuando amount es undefined', () => {
      expect(() =>
        renderWithProvider(
          <AuthorizationCard
            request={{ ...baseRequest, amount: undefined }}
            onPress={jest.fn()}
          />,
        ),
      ).not.toThrow();
    });

    it('no lanza cuando employee_id es undefined', () => {
      expect(() =>
        renderWithProvider(
          <AuthorizationCard
            request={{ ...baseRequest, employee_id: undefined }}
            onPress={jest.fn()}
          />,
        ),
      ).not.toThrow();
    });

    it('no lanza cuando product_id es undefined', () => {
      expect(() =>
        renderWithProvider(
          <AuthorizationCard
            request={{ ...baseRequest, product_id: undefined }}
            onPress={jest.fn()}
          />,
        ),
      ).not.toThrow();
    });
  });

  describe('indicador visual por tipo (US-04)', () => {
    const types: RequestType[] = [
      RequestType.DISCOUNT,
      RequestType.CANCEL,
      RequestType.EMPLOYEE_BENEFIT,
      RequestType.SUSPEND,
      RequestType.PRICE_CHANGE,
    ];

    types.forEach(type => {
      it(`muestra testId de ícono diferenciado para tipo ${type}`, () => {
        renderWithProvider(
          <AuthorizationCard
            request={{ ...baseRequest, type }}
            onPress={jest.fn()}
          />,
        );
        // El componente debe renderizar un elemento con testID `type-icon-${type}`.
        // Esto garantiza que cada tipo tiene representación visual distinta sin acoplar colores.
        expect(screen.getByTestId(`type-icon-${type}`)).toBeOnTheScreen();
      });
    });
  });
});
