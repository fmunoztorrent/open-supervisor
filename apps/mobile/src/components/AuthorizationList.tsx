import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
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
      <View style={styles.centered}>
        <Text>Cargando...</Text>
      </View>
    );
  }

  if (requests.length === 0) {
    return (
      <View style={styles.centered}>
        <Text>Sin solicitudes pendientes</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
