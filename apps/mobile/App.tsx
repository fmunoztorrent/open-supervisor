import React, { useState } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SessionProvider, useSession } from './src/context/SessionContext';
import { AuthorizationList } from './src/components/AuthorizationList';
import { AuthorizationDetailScreen } from './src/screens/AuthorizationDetailScreen';
import { useSSERequests, RequestWithResolved } from './src/hooks/useSSERequests';
import { useDecision } from './src/hooks/useDecision';

interface DetailViewProps {
  request: RequestWithResolved;
  supervisorId: string;
  onBack: () => void;
}

function DetailView({ request, supervisorId, onBack }: DetailViewProps) {
  const { decide, isLoading } = useDecision(request.correlation_id, supervisorId);

  const handleDecide = async (decision: 'APPROVE' | 'REJECT') => {
    await decide(decision);
    onBack();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Volver">
          <Text style={styles.backButton}>← Volver</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Detalle</Text>
      </View>
      <AuthorizationDetailScreen
        request={request}
        isLoading={isLoading}
        onDecide={handleDecide}
      />
    </SafeAreaView>
  );
}

function SupervisorApp() {
  const { storeId, supervisorId } = useSession();
  const { requests, isLoading, isReconnecting } = useSSERequests(storeId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedRequest = selectedId
    ? requests.find(r => r.correlation_id === selectedId)
    : undefined;

  if (selectedRequest) {
    return (
      <DetailView
        request={selectedRequest}
        supervisorId={supervisorId}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Solicitudes</Text>
        {isReconnecting && (
          <Text style={styles.reconnecting}>Reconectando...</Text>
        )}
      </View>
      <AuthorizationList
        requests={requests}
        onPressRequest={setSelectedId}
        isLoading={isLoading}
      />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <SupervisorApp />
    </SessionProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    elevation: 2,
    gap: 12,
  },
  backButton: {
    fontSize: 16,
    color: '#2196F3',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#212121',
    flex: 1,
  },
  reconnecting: {
    fontSize: 12,
    color: '#F44336',
  },
});
