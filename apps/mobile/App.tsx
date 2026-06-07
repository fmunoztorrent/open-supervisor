import React, { useState, useCallback } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
} from 'react-native';
import { config } from '@gluestack-ui/config';
import { GluestackUIProvider, HStack, Pressable, Box, Text, Spinner, Center } from '@gluestack-ui/themed';
import { SessionProvider, useSession } from './src/context/SessionContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { AuthorizationList } from './src/components/AuthorizationList';
import { AuthorizationDetailScreen } from './src/screens/AuthorizationDetailScreen';
import { useSSERequests, RequestWithResolved } from './src/hooks/useSSERequests';
import { useDecision } from './src/hooks/useDecision';

interface DetailViewProps {
  request: RequestWithResolved;
  supervisorId: string;
  onBack: () => void;
  onDecisionComplete: () => void;
}

function DetailView({ request, supervisorId, onBack, onDecisionComplete }: DetailViewProps) {
  const { decide, isLoading, error } = useDecision(request.correlation_id, supervisorId);

  const handleDecide = async (decision: 'APPROVE' | 'REJECT') => {
    const success = await decide(decision);
    if (success) {
      onDecisionComplete();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <HStack style={{ alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#FFFFFF', elevation: 2, gap: 12 }}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Volver">
          <Text style={{ fontSize: 16, color: '#2196F3' }}>← Volver</Text>
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#212121', flex: 1 }}>Detalle</Text>
      </HStack>
      <AuthorizationDetailScreen
        request={request}
        isLoading={isLoading}
        onDecide={handleDecide}
        error={error}
      />
    </SafeAreaView>
  );
}

function SupervisorApp() {
  const { storeId, supervisorId, displayName } = useSession();
  const { requests, isLoading, isReconnecting, isRefreshingBackground, refetch } = useSSERequests(storeId);
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
        onDecisionComplete={() => {
          refetch();
          setSelectedId(null);
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <HStack style={{ alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#FFFFFF', elevation: 2, gap: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#212121', flex: 1 }}>
          Solicitudes
        </Text>
        {displayName ? (
          <Text style={{ fontSize: 12, color: '#9E9E9E' }}>
            {displayName}
          </Text>
        ) : null}
        {isReconnecting && (
          <Box bg="$warning100" px="$2" py="$1" borderRadius="$sm">
            <Text color="$warning700" fontSize="$xs">Reconectando...</Text>
          </Box>
        )}
      </HStack>
      <AuthorizationList
        requests={requests}
        onPressRequest={setSelectedId}
        isLoading={isLoading}
        isRefreshingBackground={isRefreshingBackground}
      />
    </SafeAreaView>
  );
}

function AuthenticatedApp({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const { isAuthenticated, isInitializing } = useSession();

  if (isInitializing) {
    return (
      <Center style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
        <Spinner testID="session-spinner" size="large" />
      </Center>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen onLoginSuccess={onLoginSuccess} />;
  }

  return <SupervisorApp />;
}

export default function App() {
  const [loginKey, setLoginKey] = useState(0);

  const handleLoginSuccess = useCallback(() => {
    setLoginKey((k) => k + 1);
  }, []);

  return (
    <GluestackUIProvider config={config}>
      <SessionProvider key={`session-${loginKey}`}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <AuthenticatedApp onLoginSuccess={handleLoginSuccess} />
      </SessionProvider>
    </GluestackUIProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
});
