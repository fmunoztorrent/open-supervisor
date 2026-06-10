import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface UseLogoutResult {
  logout: () => Promise<void>;
  isLoading: boolean;
}

const AUTH_KEYS = ['access_token', 'refresh_token', 'expires_at'] as const;

/**
 * @param onLoggedOut callback opcional invocado tras limpiar los tokens.
 *   App.tsx pasa `refresh` de la sesión para volver al LoginScreen.
 */
export function useLogout(onLoggedOut?: () => void): UseLogoutResult {
  const [isLoading, setIsLoading] = useState(false);

  const logout = useCallback(async () => {
    Alert.alert('Cerrar sesión', '¿Estás seguro de que deseas cerrar sesión?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar sesión',
        style: 'destructive',
        onPress: async () => {
          setIsLoading(true);
          try {
            await AsyncStorage.removeItem(AUTH_KEYS[0]);
            await AsyncStorage.removeItem(AUTH_KEYS[1]);
            await AsyncStorage.removeItem(AUTH_KEYS[2]);
            onLoggedOut?.();
          } finally {
            setIsLoading(false);
          }
        },
      },
    ]);
  }, [onLoggedOut]);

  return { logout, isLoading };
}
