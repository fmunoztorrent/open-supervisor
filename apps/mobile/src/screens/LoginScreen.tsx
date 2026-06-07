import React, { useState } from 'react';
import {
  Box,
  Button,
  ButtonSpinner,
  ButtonText,
  Text,
  VStack,
} from '@gluestack-ui/themed';
import { TextInput } from 'react-native';
import { useLogin } from '../hooks/useLogin';

interface LoginScreenProps {
  onLoginSuccess: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const { login, isLoading, error } = useLogin();
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleLogin = async () => {
    setValidationError(null);

    if (!employeeId.trim() || !password.trim()) {
      setValidationError('RUT y contraseña son obligatorios');
      return;
    }

    const success = await login(employeeId.trim(), password);
    if (success) {
      onLoginSuccess();
    }
  };

  return (
    <Box style={{ flex: 1, justifyContent: 'center', backgroundColor: '#F5F5F5' }}>
      <VStack
        style={{
          marginHorizontal: 24,
          padding: 24,
          backgroundColor: '#FFFFFF',
          borderRadius: 12,
          gap: 16,
        }}
      >
        <Text
          testID="login-title"
          style={{ fontSize: 22, fontWeight: '700', color: '#212121', textAlign: 'center' }}
        >
          Open Supervisor
        </Text>

        <Text
          style={{ fontSize: 13, color: '#9E9E9E', textAlign: 'center', marginTop: -8 }}
        >
          Ingrese sus credenciales corporativas
        </Text>

        <VStack style={{ gap: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#616161' }}>RUT</Text>
          <TextInput
            testID="rut-input"
            value={employeeId}
            onChangeText={setEmployeeId}
            placeholder="12.345.678-9"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
            style={{
              borderWidth: 1,
              borderColor: '#E0E0E0',
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
              fontSize: 16,
              color: '#212121',
              backgroundColor: '#FAFAFA',
            }}
          />
        </VStack>

        <VStack style={{ gap: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#616161' }}>Contraseña</Text>
          <TextInput
            testID="password-input"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
            style={{
              borderWidth: 1,
              borderColor: '#E0E0E0',
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
              fontSize: 16,
              color: '#212121',
              backgroundColor: '#FAFAFA',
            }}
          />
        </VStack>

        {(validationError || error) && (
          <Box
            testID="login-error"
            style={{
              backgroundColor: '#FFEBEE',
              padding: 10,
              borderRadius: 8,
            }}
          >
            <Text style={{ fontSize: 13, color: '#D32F2F', textAlign: 'center' }}>
              {validationError || error}
            </Text>
          </Box>
        )}

        <Button
          testID="login-button"
          onPress={handleLogin}
          isDisabled={isLoading}
          accessibilityRole="button"
          accessibilityLabel="Ingresar"
          style={{ paddingVertical: 14, borderRadius: 8, marginTop: 4 }}
        >
          {isLoading ? (
            <ButtonSpinner testID="login-button-spinner" />
          ) : (
            <ButtonText>Ingresar</ButtonText>
          )}
        </Button>
      </VStack>
    </Box>
  );
};
