import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface UseLogoutResult {
  logout: () => Promise<void>;
  isLoading: boolean;
}

const AUTH_KEYS = ['access_token', 'refresh_token', 'expires_at'] as const;

export function useLogout(): UseLogoutResult {
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
          } finally {
            setIsLoading(false);
          }
        },
      },
    ]);
  }, []);

  return { logout, isLoading };
}
