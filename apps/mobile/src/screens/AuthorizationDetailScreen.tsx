import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  AccessibilityState,
} from 'react-native';
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
    <View style={styles.container}>
      {/* Common fields */}
      <Text style={styles.label}>Tipo: <Text style={styles.value}>{request.type}</Text></Text>
      <Text style={styles.label}>POS: <Text style={styles.value}>{request.pos_id}</Text></Text>
      <Text style={styles.label}>Tienda: <Text style={styles.value}>{request.store_id}</Text></Text>
      <Text style={styles.label}>Correlación: <Text style={styles.value}>{request.correlation_id}</Text></Text>

      {/* Conditional fields by type */}
      {request.type === RequestType.PRICE_CHANGE && (
        <View>
          <Text style={styles.label}>
            Producto: <Text style={styles.value}>{request.product_id}</Text>
          </Text>
          <Text style={styles.label}>
            Precio original: <Text style={styles.value}>{request.original_price}</Text>
          </Text>
          <Text style={styles.label}>
            Precio solicitado: <Text style={styles.value}>{request.requested_price}</Text>
          </Text>
        </View>
      )}

      {request.type === RequestType.DISCOUNT && request.amount !== undefined && (
        <Text style={styles.label}>
          Descuento: <Text style={styles.value}>{request.amount}</Text>
        </Text>
      )}

      {request.type === RequestType.EMPLOYEE_BENEFIT && request.employee_id !== undefined && (
        <Text style={styles.label}>
          Empleado: <Text style={styles.value}>{request.employee_id}</Text>
        </Text>
      )}

      {/* Resolved state text */}
      {request.resolved === 'APPROVED' && (
        <Text style={styles.resolvedText}>Ya autorizada</Text>
      )}
      {request.resolved === 'REJECTED' && (
        <Text style={styles.resolvedText}>Ya rechazada</Text>
      )}

      {/* Action buttons */}
      <View style={styles.buttonsContainer}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Autorizar"
          accessibilityState={{ disabled: isDisabled } as AccessibilityState}
          disabled={isDisabled}
          onPress={() => onDecide('APPROVE')}
          style={[styles.button, styles.approveButton, isDisabled && styles.disabledButton]}
        >
          <Text style={styles.buttonText}>Autorizar</Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Rechazar"
          accessibilityState={{ disabled: isDisabled } as AccessibilityState}
          disabled={isDisabled}
          onPress={() => onDecide('REJECT')}
          style={[styles.button, styles.rejectButton, isDisabled && styles.disabledButton]}
        >
          <Text style={styles.buttonText}>Rechazar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#FFFFFF',
  },
  label: {
    fontSize: 14,
    color: '#616161',
    marginVertical: 4,
  },
  value: {
    fontWeight: '600',
    color: '#212121',
  },
  resolvedText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#4CAF50',
    marginVertical: 8,
    textAlign: 'center',
  },
  buttonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  approveButton: {
    backgroundColor: '#4CAF50',
  },
  rejectButton: {
    backgroundColor: '#F44336',
  },
  disabledButton: {
    backgroundColor: '#BDBDBD',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
});
