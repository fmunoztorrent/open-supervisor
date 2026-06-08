import React from 'react';
import { Box, VStack, Text, Pressable } from '@gluestack-ui/themed';
import { useSession } from '../context/SessionContext';

interface UserProfileScreenProps {
  onBack: () => void;
}

function ProfileField({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <VStack style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 12, color: '#9E9E9E', marginBottom: 4 }}>{label}</Text>
      <Text
        testID={testID}
        style={{ fontSize: 15, fontWeight: '600', color: '#212121' }}
      >
        {value}
      </Text>
    </VStack>
  );
}

export const UserProfileScreen: React.FC<UserProfileScreenProps> = ({ onBack }) => {
  const session = useSession();

  return (
    <Box style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
      {/* Header */}
      <Box
        style={{
          backgroundColor: '#FFFFFF',
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 12,
          flexDirection: 'row',
          alignItems: 'center',
          borderBottomWidth: 1,
          borderBottomColor: '#E0E0E0',
        }}
      >
        <Pressable
          testID="profile-back-button"
          onPress={onBack}
          style={{ marginRight: 12 }}
        >
          <Text style={{ fontSize: 16, color: '#1976D2' }}>← Volver</Text>
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#212121' }}>
          Mi Perfil
        </Text>
      </Box>

      {/* Profile card */}
      <Box
        style={{
          backgroundColor: '#FFFFFF',
          margin: 16,
          padding: 20,
          borderRadius: 12,
          elevation: 2,
        }}
      >
        <ProfileField
          label="Nombre"
          value={session.displayName}
          testID="profile-display-name"
        />
        <ProfileField
          label="ID Supervisor"
          value={session.supervisorId}
          testID="profile-supervisor-id"
        />
        <ProfileField
          label="Tienda"
          value={session.storeId}
          testID="profile-store-id"
        />
      </Box>
    </Box>
  );
};
