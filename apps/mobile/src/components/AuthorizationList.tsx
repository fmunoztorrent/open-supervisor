import React from 'react';
import {
  Box,
  Center,
  HStack,
  ScrollView,
  Spinner,
  Text,
} from '@gluestack-ui/themed';
import { AuthorizationRequestDto } from '@open-supervisor/shared-types';
import { AuthorizationCard } from './AuthorizationCard';

type RequestWithResolved = AuthorizationRequestDto & {
  resolved?: 'APPROVED' | 'REJECTED';
};

interface AuthorizationListProps {
  requests: RequestWithResolved[];
  onPressRequest: (correlationId: string) => void;
  isLoading?: boolean;
  isRefreshingBackground?: boolean;
}

export const AuthorizationList: React.FC<AuthorizationListProps> = ({
  requests,
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

  if (requests.length === 0) {
    return (
      <Center style={{ flex: 1 }}>
        <Text>Sin solicitudes pendientes</Text>
      </Center>
    );
  }

  return (
    <Box style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }}>
        {requests.map(request => (
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
