import React, { useCallback, useState } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
} from 'react-native';
import { config } from '@gluestack-ui/config';
import { GluestackUIProvider, HStack, Pressable, Box, Text, Center, Spinner } from '@gluestack-ui/themed';
import { SessionProvider, useSession } from './src/context/SessionContext';
import { AuthorizationList } from './src/components/AuthorizationList';
import { AuthorizationDetailScreen } from './src/screens/AuthorizationDetailScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { HamburgerMenu } from './src/components/HamburgerMenu';
import { PendingBadge } from './src/components/PendingBadge';
import { PhysicalPresenceBadge } from './src/components/PhysicalPresenceBadge';
import { useSSERequests, RequestWithResolved } from './src/hooks/useSSERequests';
import { useDecision } from './src/hooks/useDecision';
import { usePhysicalPresenceDispatches } from './src/hooks/usePhysicalPresenceDispatches';
import { useLogout } from './src/hooks/useLogout';

type AppView = 'list' | 'detail' | 'profile' | 'history';

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
    <SafeAreaView style={[styles.container, { paddingTop: StatusBar.currentHeight ?? 0 }]}>
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

function SupervisorApp({ onLoggedOut }: { onLoggedOut: () => void }) {
  const { storeId, supervisorId } = useSession();
  const { requests, isLoading, isReconnecting, isRefreshingBackground, refetch } = useSSERequests(storeId);
  const { dispatches, count: presenceCount } = usePhysicalPresenceDispatches(storeId);
  const { logout } = useLogout(onLoggedOut);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<AppView>('list');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const selectedRequest = selectedId
    ? requests.find(r => r.correlation_id === selectedId)
    : undefined;

  const pendingCount = requests.filter(r => !r.resolved).length;

  const handleNavigate = (destination: 'profile' | 'history' | 'logout') => {
    setIsMenuOpen(false);
    if (destination === 'logout') {
      logout();
      return;
    }
    setCurrentView(destination === 'profile' ? 'profile' : 'history');
    setSelectedId(null);
  };

  // Detail view
  if (currentView === 'detail' && selectedRequest) {
    return (
      <DetailView
        request={selectedRequest}
        supervisorId={supervisorId}
        onBack={() => {
          setSelectedId(null);
          setCurrentView('list');
        }}
        onDecisionComplete={() => {
          refetch();
          setSelectedId(null);
          setCurrentView('list');
        }}
      />
    );
  }

  // Profile view (placeholder until US-02 is implemented)
  if (currentView === 'profile') {
    const { UserProfileScreen } = require('./src/screens/UserProfileScreen');
    return (
      <SafeAreaView style={[styles.container, { paddingTop: StatusBar.currentHeight ?? 0 }]}>
        <UserProfileScreen onBack={() => setCurrentView('list')} />
      </SafeAreaView>
    );
  }

  // History view (placeholder until US-04 is implemented)
  if (currentView === 'history') {
    const { HistoryScreen } = require('./src/screens/HistoryScreen');
    return (
      <SafeAreaView style={[styles.container, { paddingTop: StatusBar.currentHeight ?? 0 }]}>
        <HistoryScreen storeId={storeId} onBack={() => setCurrentView('list')} />
      </SafeAreaView>
    );
  }

  // List view (default)
  return (
    <SafeAreaView testID="app-safe-area" style={[styles.container, { paddingTop: StatusBar.currentHeight ?? 0 }]}>
      <HStack style={{ alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#FFFFFF', elevation: 2, gap: 8 }}>
        <Pressable
          testID="hamburger-button"
          onPress={() => setIsMenuOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Abrir menú"
        >
          <Text style={{ fontSize: 22 }}>☰</Text>
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#212121', flex: 1 }}>Solicitudes</Text>
        <Box testID="presence-badge-container">
          <PhysicalPresenceBadge count={presenceCount} />
        </Box>
        <PendingBadge count={pendingCount} />
        {isReconnecting && (
          <Box bg="$warning100" px="$2" py="$1" borderRadius="$sm">
            <Text color="$warning700" fontSize="$xs">Reconectando...</Text>
          </Box>
        )}
      </HStack>

      {isMenuOpen && (
        <HamburgerMenu
          isOpen={isMenuOpen}
          onClose={() => setIsMenuOpen(false)}
          onNavigate={handleNavigate}
        />
      )}

      <AuthorizationList
        requests={requests}
        physicalPresenceDispatches={dispatches}
        onPressRequest={(correlationId) => {
          setSelectedId(correlationId);
          setCurrentView('detail');
        }}
        isLoading={isLoading}
        isRefreshingBackground={isRefreshingBackground}
      />
    </SafeAreaView>
  );
}

// Gate de autenticación: decide entre splash, login y la app del supervisor
// según el estado de la sesión (token Keycloak en AsyncStorage).
function AuthenticatedApp() {
  const { isAuthenticated, isInitializing, refresh } = useSession();
  const handleLoginSuccess = useCallback(() => {
    refresh();
  }, [refresh]);

  if (isInitializing) {
    return (
      <Center style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
        <Spinner testID="session-spinner" size="large" />
      </Center>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  return <SupervisorApp onLoggedOut={refresh} />;
}

export default function App() {
  return (
    <GluestackUIProvider config={config}>
      <SessionProvider>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <AuthenticatedApp />
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
