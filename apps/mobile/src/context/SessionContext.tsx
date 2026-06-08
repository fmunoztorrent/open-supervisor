import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';

interface KeycloakClaims {
  sub: string;
  preferred_username?: string;
  storeId?: string;
  displayName?: string;
  exp: number;
}

interface Session {
  storeId: string;
  supervisorId: string;
  displayName: string;
  isAuthenticated: boolean;
  isInitializing: boolean;
}

interface SessionContextValue extends Session {
  /** Re-lee el token desde AsyncStorage y recalcula la sesión.
   * Lo invocan LoginScreen (tras login) y el logout (para volver al login). */
  refresh: () => Promise<void>;
}

const INITIAL: Session = {
  storeId: '',
  supervisorId: '',
  displayName: '',
  isAuthenticated: false,
  isInitializing: true,
};

const AUTH_KEYS = ['access_token', 'refresh_token', 'expires_at'] as const;

const SessionContext = createContext<SessionContextValue>({
  ...INITIAL,
  refresh: async () => {},
});

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [session, setSession] = useState<Session>(INITIAL);

  const refresh = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('access_token');
      if (!token) {
        setSession({ ...INITIAL, isInitializing: false });
        return;
      }

      const claims = jwtDecode<KeycloakClaims>(token);
      const now = Math.floor(Date.now() / 1000);

      if (claims.exp && claims.exp < now) {
        // Token expirado — limpiar y forzar re-login
        await Promise.all(AUTH_KEYS.map((k) => AsyncStorage.removeItem(k)));
        setSession({ ...INITIAL, isInitializing: false });
        return;
      }

      setSession({
        storeId: claims.storeId || '',
        supervisorId: claims.sub,
        displayName: claims.displayName || claims.preferred_username || '',
        isAuthenticated: true,
        isInitializing: false,
      });
    } catch {
      // Token inválido en storage — limpiar
      await Promise.all(AUTH_KEYS.map((k) => AsyncStorage.removeItem(k)));
      setSession({ ...INITIAL, isInitializing: false });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <SessionContext.Provider value={{ ...session, refresh }}>
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = () => useContext(SessionContext);
