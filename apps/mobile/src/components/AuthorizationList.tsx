import React from 'react';
import {
  Box,
  Center,
  HStack,
  ScrollView,
  Spinner,
  Text,
} from '@gluestack-ui/themed';
import { AuthorizationRequestDto, PhysicalPresenceDispatchDto } from '@open-supervisor/shared-types';
import { AuthorizationCard } from './AuthorizationCard';

type RequestWithResolved = AuthorizationRequestDto & {
  resolved?: 'APPROVED' | 'REJECTED';
};

interface AuthorizationListProps {
  requests: RequestWithResolved[];
  physicalPresenceDispatches?: PhysicalPresenceDispatchDto[];
  onPressRequest: (correlationId: string) => void;
  isLoading?: boolean;
  isRefreshingBackground?: boolean;
}

export const AuthorizationList: React.FC<AuthorizationListProps> = ({
  requests,
  physicalPresenceDispatches = [],
  onPressRequest,
  isLoading = false,
  isRefreshingBackground = false,
}) => {
  if (isLoading) {
    return (
      <Center style={{ flex: 1 }}>
        <Spinner testID="list-spinner" />
      </Center>
    );
  }

  const hasContent = requests.length > 0 || physicalPresenceDispatches.length > 0;

  if (!hasContent) {
    return (
      <Center style={{ flex: 1 }}>
        <Text>Sin solicitudes pendientes</Text>
      </Center>
    );
  }

  return (
    <Box style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }}>
        {/* Physical presence dispatches first */}
        {physicalPresenceDispatches.map((dispatch) => (
          <AuthorizationCard
            key={`presence-${dispatch.correlation_id}`}
            request={{
              store_id: dispatch.store_id,
              pos_id: dispatch.pos_id,
              correlation_id: dispatch.correlation_id,
              type: 'PRICE_CHANGE' as any,
              product_id: dispatch.product_id,
              original_price: dispatch.original_price,
              requested_price: dispatch.requested_price,
              created_at: new Date().toISOString(),
            }}
            isPhysicalPresence={true}
            onPress={() => {}}
          />
        ))}

        {/* Authorization requests */}
        {requests.map((request) => (
          <AuthorizationCard
            key={request.correlation_id}
            request={request}
            onPress={() => onPressRequest(request.correlation_id)}
          />
        ))}
      </ScrollView>

      {isRefreshingBackground && (
        <Box
          testID="background-refresh-indicator"
          accessible={true}
          accessibilityLabel="Indicador de sincronización"
          style={{
            opacity: 0.7,
            height: 32,
            backgroundColor: '#E3F2FD',
            borderTopWidth: 1,
            borderTopColor: '#BBDEFB',
          }}
        >
          <HStack
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Spinner size="small" color="#1976D2" />
            <Text style={{ marginLeft: 8, fontSize: 12, color: '#1976D2' }}>
              Sincronizando...
            </Text>
          </HStack>
        </Box>
      )}
    </Box>
  );
};
