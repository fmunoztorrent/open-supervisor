import React from 'react';
import {
  Center,
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
}

export const AuthorizationList: React.FC<AuthorizationListProps> = ({
  requests,
  onPressRequest,
  isLoading = false,
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
    <ScrollView style={{ flex: 1 }}>
      {requests.map(request => (
        <AuthorizationCard
          key={request.correlation_id}
          request={request}
          onPress={() => onPressRequest(request.correlation_id)}
        />
      ))}
    </ScrollView>
  );
};
