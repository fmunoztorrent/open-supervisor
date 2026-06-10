import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, StyleSheet } from 'react-native';
import { Box, VStack, Text, Pressable } from '@gluestack-ui/themed';
import { useSession } from '../context/SessionContext';

interface HamburgerMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (destination: 'profile' | 'history' | 'logout') => void;
}

const PANEL_WIDTH = Dimensions.get('window').width * 0.75;

const MENU_ITEMS: { label: string; destination: 'profile' | 'history' | 'logout'; testID: string }[] = [
  { label: 'Mi Perfil', destination: 'profile', testID: 'menu-item-profile' },
  { label: 'Historial', destination: 'history', testID: 'menu-item-history' },
  { label: 'Cerrar sesión', destination: 'logout', testID: 'menu-item-logout' },
];

export const HamburgerMenu: React.FC<HamburgerMenuProps> = ({
  isOpen,
  onClose,
  onNavigate,
}) => {
  const session = useSession();
  const slideAnim = useRef(new Animated.Value(-PANEL_WIDTH)).current;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: isOpen ? 0 : -PANEL_WIDTH,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isOpen, slideAnim]);

  const overlayOpacity = slideAnim.interpolate({
    inputRange: [-PANEL_WIDTH, 0],
    outputRange: [0, 1],
  });

  return (
    <Box style={styles.container} pointerEvents={isOpen ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: overlayOpacity }]}>
        <Pressable
          testID="hamburger-overlay"
          onPress={onClose}
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.4)',
          }}
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.panel,
          { transform: [{ translateX: slideAnim }] },
        ]}
      >
        <Box
          testID="hamburger-panel"
          style={{
            flex: 1,
            backgroundColor: '#FFFFFF',
            borderTopRightRadius: 16,
            borderBottomRightRadius: 16,
            paddingTop: 50,
          }}
        >
          <VStack
            style={{
              paddingHorizontal: 20,
              paddingBottom: 20,
              borderBottomWidth: 1,
              borderBottomColor: '#E0E0E0',
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#212121' }}>
              {session.displayName}
            </Text>
            <Text style={{ fontSize: 12, color: '#757575', marginTop: 4 }}>
              {session.supervisorId}
            </Text>
          </VStack>
          <VStack style={{ marginTop: 8 }}>
            {MENU_ITEMS.map((item) => (
              <Pressable
                key={item.destination}
                testID={item.testID}
                onPress={() => onNavigate(item.destination)}
                style={{
                  paddingLeft: 20,
                  paddingVertical: 16,
                  borderBottomWidth: 1,
                  borderBottomColor: '#F5F5F5',
                }}
              >
                <Text style={{ fontSize: 16, color: '#212121' }}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </VStack>
        </Box>
      </Animated.View>
    </Box>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    elevation: 1000,
  },
  panel: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: PANEL_WIDTH,
  },
});
