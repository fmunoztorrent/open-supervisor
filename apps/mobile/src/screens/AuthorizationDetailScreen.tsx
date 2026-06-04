import React from 'react';
import {
  Box,
  Button,
  ButtonSpinner,
  ButtonText,
  HStack,
  Text,
  VStack,
} from '@gluestack-ui/themed';
import { AuthorizationRequestDto, RequestType } from '@open-supervisor/shared-types';

type RequestWithResolved = AuthorizationRequestDto & {
  resolved?: 'APPROVED' | 'REJECTED';
};

interface AuthorizationDetailScreenProps {
  request: RequestWithResolved;
  isLoading: boolean;
  onDecide: (decision: 'APPROVE' | 'REJECT') => void;
}

export const AuthorizationDetailScreen: React.FC<
  AuthorizationDetailScreenProps
> = ({ request, isLoading, onDecide }) => {
  const isDisabled = isLoading || !!request.resolved;

  return (
    <Box style={{ flex: 1, padding: 16, backgroundColor: '#FFFFFF' }}>
      <VStack>
        {/* Common fields */}
        <Text style={{ fontSize: 14, color: '#616161', marginVertical: 4 }}>
          Tipo: <Text style={{ fontWeight: '600', color: '#212121' }}>{request.type}</Text>
        </Text>
        <Text style={{ fontSize: 14, color: '#616161', marginVertical: 4 }}>
          POS: <Text style={{ fontWeight: '600', color: '#212121' }}>{request.pos_id}</Text>
        </Text>
        <Text style={{ fontSize: 14, color: '#616161', marginVertical: 4 }}>
          Tienda: <Text style={{ fontWeight: '600', color: '#212121' }}>{request.store_id}</Text>
        </Text>
        <Text style={{ fontSize: 14, color: '#616161', marginVertical: 4 }}>
          Correlación: <Text style={{ fontWeight: '600', color: '#212121' }}>{request.correlation_id}</Text>
        </Text>

        {/* Conditional fields by type */}
        {request.type === RequestType.PRICE_CHANGE && (
          <VStack>
            <Text style={{ fontSize: 14, color: '#616161', marginVertical: 4 }}>
              Producto: <Text style={{ fontWeight: '600', color: '#212121' }}>{request.product_id}</Text>
            </Text>
            <Text style={{ fontSize: 14, color: '#616161', marginVertical: 4 }}>
              Precio original: <Text style={{ fontWeight: '600', color: '#212121' }}>{request.original_price}</Text>
            </Text>
            <Text style={{ fontSize: 14, color: '#616161', marginVertical: 4 }}>
              Precio solicitado: <Text style={{ fontWeight: '600', color: '#212121' }}>{request.requested_price}</Text>
            </Text>
          </VStack>
        )}

        {request.type === RequestType.DISCOUNT && request.amount !== undefined && (
          <Text style={{ fontSize: 14, color: '#616161', marginVertical: 4 }}>
            Descuento: <Text style={{ fontWeight: '600', color: '#212121' }}>{request.amount}</Text>
          </Text>
        )}

        {request.type === RequestType.EMPLOYEE_BENEFIT && request.employee_id !== undefined && (
          <Text style={{ fontSize: 14, color: '#616161', marginVertical: 4 }}>
            Empleado: <Text style={{ fontWeight: '600', color: '#212121' }}>{request.employee_id}</Text>
          </Text>
        )}

        {/* Resolved state text */}
        {request.resolved === 'APPROVED' && (
          <Text
            style={{
              fontSize: 16,
              fontWeight: '700',
              color: '#4CAF50',
              marginVertical: 8,
              textAlign: 'center',
            }}
          >
            Ya autorizada
          </Text>
        )}
        {request.resolved === 'REJECTED' && (
          <Text
            style={{
              fontSize: 16,
              fontWeight: '700',
              color: '#4CAF50',
              marginVertical: 8,
              textAlign: 'center',
            }}
          >
            Ya rechazada
          </Text>
        )}

        {/* Action buttons */}
        <HStack
          style={{
            justifyContent: 'space-between',
            marginTop: 24,
            gap: 12,
          }}
        >
          <Button
            accessibilityRole="button"
            accessibilityLabel="Autorizar"
            accessibilityState={{ disabled: isDisabled }}
            isDisabled={isDisabled}
            onPress={() => onDecide('APPROVE')}
            style={{ flex: 1, paddingVertical: 14, borderRadius: 8 }}
          >
            {isLoading ? (
              <ButtonSpinner testID="approve-button-spinner" />
            ) : (
              <ButtonText>Autorizar</ButtonText>
            )}
          </Button>

          <Button
            accessibilityRole="button"
            accessibilityLabel="Rechazar"
            accessibilityState={{ disabled: isDisabled }}
            isDisabled={isDisabled}
            onPress={() => onDecide('REJECT')}
            style={{ flex: 1, paddingVertical: 14, borderRadius: 8 }}
          >
            <ButtonText>Rechazar</ButtonText>
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
};
