import { useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { bffClient } from '../api/bffClient';

interface LoginResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface UseLoginResult {
  login: (employeeId: string, password: string) => Promise<boolean>;
  isLoading: boolean;
  error: string | null;
}

export function useLogin(): UseLoginResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async (
    employeeId: string,
    password: string,
  ): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      const result: LoginResult = await bffClient.post('/auth/login', {
        employeeId,
        password,
      });

      await AsyncStorage.setItem('access_token', result.access_token);
      await AsyncStorage.setItem('refresh_token', result.refresh_token);
      await AsyncStorage.setItem(
        'expires_at',
        String(Date.now() + result.expires_in * 1000),
      );

      return true;
    } catch (err: unknown) {
      if (err instanceof Error) {
        const statusMatch = err.message.match(/HTTP (\d+)/);
        const status = statusMatch ? parseInt(statusMatch[1]) : 0;

        if (status === 401) {
          setError('Credenciales inválidas');
        } else if (status === 403) {
          setError('Cuenta deshabilitada');
        } else if (status === 503 || status === 0) {
          setError('Servicio no disponible. Intente más tarde.');
        } else {
          setError('Error de conexión');
        }
      } else {
        setError('Error de conexión');
      }
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return { login, isLoading, error };
}
