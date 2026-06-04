import React from 'react';
import {
  Box,
  Button,
  ButtonSpinner,
  ButtonText,
  HStack,
  ScrollView,
  Text,
} from '@gluestack-ui/themed';
import { AuthorizationRequestDto, RequestType } from '@open-supervisor/shared-types';

export type RequestWithResolved = AuthorizationRequestDto & {
  resolved?: 'APPROVED' | 'REJECTED';
};

interface AuthorizationDetailScreenProps {
  request: RequestWithResolved;
  isLoading: boolean;
  onDecide: (decision: 'APPROVE' | 'REJECT') => void;
  error?: string | null;
}

const TYPE_COLORS: Record<RequestType, string> = {
  [RequestType.DISCOUNT]: '#2196F3',
  [RequestType.CANCEL]: '#F44336',
  [RequestType.EMPLOYEE_BENEFIT]: '#9C27B0',
  [RequestType.SUSPEND]: '#FF9800',
  [RequestType.PRICE_CHANGE]: '#4CAF50',
};

const TYPE_LABELS: Record<RequestType, string> = {
  [RequestType.DISCOUNT]: 'Descuento',
  [RequestType.CANCEL]: 'Cancelación',
  [RequestType.EMPLOYEE_BENEFIT]: 'Beneficio Empleado',
  [RequestType.SUSPEND]: 'Suspensión',
  [RequestType.PRICE_CHANGE]: 'Cambio de Precio',
};

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    const day = d.getUTCDate().toString().padStart(2, '0');
    const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const year = d.getUTCFullYear();
    const hours = d.getUTCHours().toString().padStart(2, '0');
    const minutes = d.getUTCMinutes().toString().padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  } catch {
    return isoString;
  }
}

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <HStack
      style={{
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
        alignItems: 'center',
      }}
    >
      <Text style={{ fontSize: 13, color: '#9E9E9E', flex: 1 }}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: '600', color: '#212121' }}>
        {String(value)}
      </Text>
    </HStack>
  );
}

export const AuthorizationDetailScreen: React.FC<AuthorizationDetailScreenProps> = ({
  request,
  isLoading,
  onDecide,
  error,
}) => {
  const isDisabled = isLoading || !!request.resolved;
  const typeColor = TYPE_COLORS[request.type] ?? '#607D8B';
  const typeLabel = TYPE_LABELS[request.type] ?? request.type;

  return (
    <Box style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
      {/* Header with type label and color accent */}
      <Box
        testID="detail-type-header"
        style={{
          backgroundColor: '#FFFFFF',
          borderLeftWidth: 6,
          borderLeftColor: typeColor,
          paddingHorizontal: 16,
          paddingVertical: 12,
          marginBottom: 8,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#212121' }}>
          {typeLabel}
        </Text>
        <Text
          testID="detail-created-at"
          style={{ fontSize: 12, color: '#9E9E9E', marginTop: 2 }}
        >
          {formatDate(request.created_at)}
        </Text>
      </Box>

      <ScrollView>
        {/* Common info fields */}
        <Box style={{ backgroundColor: '#FFFFFF', paddingHorizontal: 16, marginBottom: 8 }}>
          <InfoRow label="POS" value={request.pos_id} />
          <InfoRow label="Tienda" value={request.store_id} />
          <InfoRow label="Correlación" value={request.correlation_id} />

          {/* Type-specific fields */}
          {request.type === RequestType.PRICE_CHANGE && (
            <>
              <InfoRow label="Producto" value={request.product_id ?? '-'} />
              <InfoRow label="Precio original" value={request.original_price ?? '-'} />
              <InfoRow label="Precio solicitado" value={request.requested_price ?? '-'} />
            </>
          )}

          {request.type === RequestType.DISCOUNT && request.amount !== undefined && (
            <InfoRow label="Monto" value={request.amount} />
          )}

          {request.type === RequestType.EMPLOYEE_BENEFIT && request.employee_id !== undefined && (
            <InfoRow label="Empleado" value={request.employee_id} />
          )}
        </Box>

        {/* Resolved state banners */}
        {request.resolved === 'APPROVED' && (
          <Box
            style={{
              backgroundColor: '#E8F5E9',
              padding: 12,
              marginHorizontal: 16,
              marginBottom: 8,
              borderRadius: 8,
            }}
          >
            <Text
              style={{ fontSize: 15, fontWeight: '700', color: '#388E3C', textAlign: 'center' }}
            >
              Ya autorizada
            </Text>
          </Box>
        )}

        {request.resolved === 'REJECTED' && (
          <Box
            style={{
              backgroundColor: '#FFEBEE',
              padding: 12,
              marginHorizontal: 16,
              marginBottom: 8,
              borderRadius: 8,
            }}
          >
            <Text
              style={{ fontSize: 15, fontWeight: '700', color: '#D32F2F', textAlign: 'center' }}
            >
              Ya rechazada
            </Text>
          </Box>
        )}

        {/* Error banner */}
        {!!error && (
          <Box
            testID="detail-error"
            style={{
              backgroundColor: '#FFEBEE',
              padding: 12,
              marginHorizontal: 16,
              marginBottom: 8,
              borderRadius: 8,
            }}
          >
            <Text style={{ fontSize: 13, color: '#D32F2F', textAlign: 'center' }}>{error}</Text>
          </Box>
        )}

        {/* Action buttons */}
        <HStack style={{ padding: 16, gap: 12 }}>
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
      </ScrollView>
    </Box>
  );
};
