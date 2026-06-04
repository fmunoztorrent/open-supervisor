import React from 'react';
import { screen, fireEvent } from '@testing-library/react-native';
import { AuthorizationRequestDto, RequestType } from '@open-supervisor/shared-types';

// renderWithProvider is injected by jest.setup.js
declare const renderWithProvider: (ui: React.ReactElement, options?: any) => ReturnType<typeof import('@testing-library/react-native').render>;

// Este import fallará con "Cannot find module" hasta que la pantalla sea implementada.
import { AuthorizationDetailScreen } from '../AuthorizationDetailScreen';

const basePriceChangeRequest: AuthorizationRequestDto = {
  store_id: 'store-42',
  pos_id: 'pos-1',
  correlation_id: 'corr-99',
  type: RequestType.PRICE_CHANGE,
  created_at: '2026-06-03T10:30:00.000Z',
  product_id: 'prod-1',
  original_price: 1000,
  requested_price: 600,
};

const discountRequest: AuthorizationRequestDto = {
  store_id: 'store-42',
  pos_id: 'pos-1',
  correlation_id: 'corr-100',
  type: RequestType.DISCOUNT,
  created_at: '2026-06-03T11:00:00.000Z',
  amount: 250,
};

const employeeBenefitRequest: AuthorizationRequestDto = {
  store_id: 'store-42',
  pos_id: 'pos-1',
  correlation_id: 'corr-101',
  type: RequestType.EMPLOYEE_BENEFIT,
  created_at: '2026-06-03T11:15:00.000Z',
  employee_id: 'emp-007',
};

describe('AuthorizationDetailScreen', () => {
  describe('renderizado de campos según tipo', () => {
    it('muestra product_id, original_price y requested_price para PRICE_CHANGE', () => {
      renderWithProvider(
        <AuthorizationDetailScreen
          request={basePriceChangeRequest}
          isLoading={false}
          onDecide={jest.fn()}
        />,
      );
      expect(screen.getByText(/prod-1/i)).toBeOnTheScreen();
      expect(screen.getByText(/1000/)).toBeOnTheScreen();
      expect(screen.getByText(/600/)).toBeOnTheScreen();
    });

    it('muestra amount para tipo DISCOUNT', () => {
      renderWithProvider(
        <AuthorizationDetailScreen
          request={discountRequest}
          isLoading={false}
          onDecide={jest.fn()}
        />,
      );
      expect(screen.getByText(/250/)).toBeOnTheScreen();
    });

    it('muestra employee_id para tipo EMPLOYEE_BENEFIT', () => {
      renderWithProvider(
        <AuthorizationDetailScreen
          request={employeeBenefitRequest}
          isLoading={false}
          onDecide={jest.fn()}
        />,
      );
      expect(screen.getByText(/emp-007/i)).toBeOnTheScreen();
    });
  });

  describe('botones de acción', () => {
    it('ambos botones "Autorizar" y "Rechazar" están presentes', () => {
      renderWithProvider(
        <AuthorizationDetailScreen
          request={basePriceChangeRequest}
          isLoading={false}
          onDecide={jest.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: /autorizar/i })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: /rechazar/i })).toBeOnTheScreen();
    });

    it('presionar "Autorizar" llama a onDecide con "APPROVE"', () => {
      const onDecide = jest.fn();
      renderWithProvider(
        <AuthorizationDetailScreen
          request={basePriceChangeRequest}
          isLoading={false}
          onDecide={onDecide}
        />,
      );
      fireEvent.press(screen.getByRole('button', { name: /autorizar/i }));
      expect(onDecide).toHaveBeenCalledWith('APPROVE');
    });

    it('presionar "Rechazar" llama a onDecide con "REJECT"', () => {
      const onDecide = jest.fn();
      renderWithProvider(
        <AuthorizationDetailScreen
          request={basePriceChangeRequest}
          isLoading={false}
          onDecide={onDecide}
        />,
      );
      fireEvent.press(screen.getByRole('button', { name: /rechazar/i }));
      expect(onDecide).toHaveBeenCalledWith('REJECT');
    });
  });

  describe('estado de carga', () => {
    it('ambos botones tienen accessibilityState.disabled=true cuando isLoading=true', () => {
      renderWithProvider(
        <AuthorizationDetailScreen
          request={basePriceChangeRequest}
          isLoading={true}
          onDecide={jest.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: /autorizar/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /rechazar/i })).toBeDisabled();
    });

    it('muestra ButtonSpinner en botón Autorizar cuando isLoading es true', () => {
      // FASE RED: este test DEBE FALLAR porque el componente actual no usa ButtonSpinner
      // de @gluestack-ui/themed. El frontend debe reemplazar el TouchableOpacity del botón
      // Autorizar por un Button de Gluestack con ButtonSpinner interno asignado
      // testID='approve-button-spinner' para que este test pase.
      renderWithProvider(
        <AuthorizationDetailScreen
          request={basePriceChangeRequest}
          isLoading={true}
          onDecide={jest.fn()}
        />,
      );
      expect(screen.getByTestId('approve-button-spinner')).toBeTruthy();
    });

    it('los botones están habilitados cuando isLoading=false y la solicitud está pendiente', () => {
      renderWithProvider(
        <AuthorizationDetailScreen
          request={basePriceChangeRequest}
          isLoading={false}
          onDecide={jest.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: /autorizar/i })).toBeEnabled();
      expect(screen.getByRole('button', { name: /rechazar/i })).toBeEnabled();
    });
  });

  describe('cabecera de tipo y fecha', () => {
    it('muestra la etiqueta legible del tipo PRICE_CHANGE', () => {
      renderWithProvider(
        <AuthorizationDetailScreen
          request={basePriceChangeRequest}
          isLoading={false}
          onDecide={jest.fn()}
        />,
      );
      expect(screen.getByText(/cambio de precio/i)).toBeOnTheScreen();
    });

    it('muestra el created_at formateado en el encabezado', () => {
      renderWithProvider(
        <AuthorizationDetailScreen
          request={basePriceChangeRequest}
          isLoading={false}
          onDecide={jest.fn()}
        />,
      );
      // created_at: '2026-06-03T10:30:00.000Z' → '03/06/2026 10:30'
      expect(screen.getByTestId('detail-created-at')).toBeOnTheScreen();
      expect(screen.getByText(/03\/06\/2026/)).toBeOnTheScreen();
    });

    it('muestra la etiqueta "Descuento" para tipo DISCOUNT', () => {
      renderWithProvider(
        <AuthorizationDetailScreen
          request={discountRequest}
          isLoading={false}
          onDecide={jest.fn()}
        />,
      );
      expect(screen.getByText(/descuento/i)).toBeOnTheScreen();
    });
  });

  describe('banner de error', () => {
    it('no muestra el banner de error cuando error es null', () => {
      renderWithProvider(
        <AuthorizationDetailScreen
          request={basePriceChangeRequest}
          isLoading={false}
          onDecide={jest.fn()}
          error={null}
        />,
      );
      expect(screen.queryByTestId('detail-error')).toBeNull();
    });

    it('muestra el banner de error con el mensaje cuando error es un string', () => {
      renderWithProvider(
        <AuthorizationDetailScreen
          request={basePriceChangeRequest}
          isLoading={false}
          onDecide={jest.fn()}
          error="Error al enviar la decisión"
        />,
      );
      expect(screen.getByTestId('detail-error')).toBeOnTheScreen();
      expect(screen.getByText(/error al enviar la decisión/i)).toBeOnTheScreen();
    });
  });

  describe('solicitud ya resuelta', () => {
    it('ambos botones están deshabilitados cuando resolved=APPROVED', () => {
      renderWithProvider(
        <AuthorizationDetailScreen
          request={{ ...basePriceChangeRequest, resolved: 'APPROVED' }}
          isLoading={false}
          onDecide={jest.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: /autorizar/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /rechazar/i })).toBeDisabled();
    });

    it('muestra texto de estado cuando resolved=APPROVED', () => {
      renderWithProvider(
        <AuthorizationDetailScreen
          request={{ ...basePriceChangeRequest, resolved: 'APPROVED' }}
          isLoading={false}
          onDecide={jest.fn()}
        />,
      );
      // El spec menciona "Ya autorizada" como texto de estado visible
      expect(screen.getByText(/ya autorizada/i)).toBeOnTheScreen();
    });

    it('ambos botones están deshabilitados cuando resolved=REJECTED', () => {
      renderWithProvider(
        <AuthorizationDetailScreen
          request={{ ...basePriceChangeRequest, resolved: 'REJECTED' }}
          isLoading={false}
          onDecide={jest.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: /autorizar/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /rechazar/i })).toBeDisabled();
    });

    it('muestra texto de estado cuando resolved=REJECTED', () => {
      renderWithProvider(
        <AuthorizationDetailScreen
          request={{ ...basePriceChangeRequest, resolved: 'REJECTED' }}
          isLoading={false}
          onDecide={jest.fn()}
        />,
      );
      expect(screen.getByText(/ya rechazada/i)).toBeOnTheScreen();
    });
  });
});
