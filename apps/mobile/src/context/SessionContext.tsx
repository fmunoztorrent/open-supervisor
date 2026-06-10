import React, { createContext, useContext, useEffect, useState } from 'react';
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

const SessionContext = createContext<Session>({
  storeId: '',
  supervisorId: '',
  displayName: '',
  isAuthenticated: false,
  isInitializing: true,
});

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [session, setSession] = useState<Session>({
    storeId: '',
    supervisorId: '',
    displayName: '',
    isAuthenticated: false,
    isInitializing: true,
  });

  useEffect(() => {
    const initSession = async () => {
      try {
        const token = await AsyncStorage.getItem('access_token');
        if (!token) {
          setSession((prev) => ({ ...prev, isInitializing: false }));
          return;
        }

        const claims = jwtDecode<KeycloakClaims>(token);
        const now = Math.floor(Date.now() / 1000);

        if (claims.exp && claims.exp < now) {
          // Token expired — clean up and force re-login
          await AsyncStorage.removeItem('access_token');
          await AsyncStorage.removeItem('refresh_token');
          await AsyncStorage.removeItem('expires_at');
          setSession((prev) => ({ ...prev, isInitializing: false }));
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
        // Invalid token in storage — clean up
        await AsyncStorage.removeItem('access_token');
        await AsyncStorage.removeItem('refresh_token');
        await AsyncStorage.removeItem('expires_at');
        setSession((prev) => ({ ...prev, isInitializing: false }));
      }
    };

    initSession();
  }, []);

  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = () => useContext(SessionContext);
