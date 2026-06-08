import React from 'react';
import {
  Box,
  Center,
  HStack,
  Pressable,
  ScrollView,
  Spinner,
  Text,
  VStack,
} from '@gluestack-ui/themed';
import { AuthorizationRequestDto } from '@open-supervisor/shared-types';
import { AuthorizationCard } from '../components/AuthorizationCard';
import { StatusFilter, useRequestHistory } from '../hooks/useRequestHistory';

type RequestWithResolved = AuthorizationRequestDto & {
  resolved?: 'APPROVED' | 'REJECTED';
};

const FILTER_OPTIONS: { key: StatusFilter; label: string; testID: string }[] = [
  { key: 'ALL', label: 'Todas', testID: 'history-filter-all' },
  { key: 'APPROVED', label: 'Autorizadas', testID: 'history-filter-approved' },
  { key: 'REJECTED', label: 'Rechazadas', testID: 'history-filter-rejected' },
];

interface HistoryScreenProps {
  storeId: string;
  onBack: () => void;
}

export const HistoryScreen: React.FC<HistoryScreenProps> = ({
  storeId,
  onBack,
}) => {
  const {
    requests,
    isLoading,
    error,
    statusFilter,
    setStatusFilter,
    refetch,
  } = useRequestHistory(storeId);

  const renderContent = () => {
    if (isLoading) {
      return (
        <Center style={{ flex: 1 }}>
          <Spinner testID="list-spinner" />
        </Center>
      );
    }

    if (error) {
      return (
        <Center style={{ flex: 1, paddingHorizontal: 16 }}>
          <Text
            style={{
              color: '#D32F2F',
              fontSize: 14,
              textAlign: 'center',
              marginBottom: 16,
            }}
          >
            {error}
          </Text>
          <Pressable testID="history-retry-button" onPress={refetch}>
            <Text style={{ color: '#2196F3', fontSize: 14, fontWeight: '600' }}>
              Reintentar
            </Text>
          </Pressable>
        </Center>
      );
    }

    if (requests.length === 0) {
      return (
        <Center testID="history-empty" style={{ flex: 1 }}>
          <Text style={{ color: '#9E9E9E', fontSize: 16 }}>
            No hay solicitudes resueltas aún.
          </Text>
        </Center>
      );
    }

    return (
      <ScrollView>
        {requests.map((request) => (
          <Box
            key={request.correlation_id}
            testID={`history-item-${request.correlation_id}`}
          >
            <AuthorizationCard
              request={request as RequestWithResolved}
              onPress={() => {}}
            />
          </Box>
        ))}
      </ScrollView>
    );
  };

  return (
    <Box style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
      <HStack
        style={{
          padding: 16,
          backgroundColor: '#FFFFFF',
          alignItems: 'center',
        }}
      >
        <Pressable testID="history-back-button" onPress={onBack}>
          <Text style={{ color: '#2196F3', fontSize: 16 }}>Volver</Text>
        </Pressable>
        <Text
          style={{
            fontSize: 18,
            fontWeight: '700',
            color: '#212121',
            marginLeft: 16,
          }}
        >
          Historial
        </Text>
      </HStack>

      <HStack
        style={{
          padding: 12,
          backgroundColor: '#FFFFFF',
          justifyContent: 'space-around',
          borderBottomWidth: 1,
          borderBottomColor: '#E0E0E0',
        }}
      >
        {FILTER_OPTIONS.map(({ key, label, testID }) => {
          const isActive = statusFilter === key;
          return (
            <Pressable
              key={key}
              testID={testID}
              onPress={() => setStatusFilter(key)}
            >
              <VStack style={{ alignItems: 'center', paddingHorizontal: 4 }}>
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: isActive ? '600' : '400',
                    color: isActive ? '#2196F3' : '#9E9E9E',
                  }}
                >
                  {label}
                </Text>
                {isActive && (
                  <Box
                    style={{
                      height: 2,
                      backgroundColor: '#2196F3',
                      width: '100%',
                      marginTop: 4,
                    }}
                  />
                )}
              </VStack>
            </Pressable>
          );
        })}
      </HStack>

      <Box style={{ flex: 1 }}>{renderContent()}</Box>
    </Box>
  );
};
