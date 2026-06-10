import React from 'react';
import { Badge, BadgeText, Box, Text } from '@gluestack-ui/themed';

interface PhysicalPresenceBadgeProps {
  count: number;
}

export const PhysicalPresenceBadge: React.FC<PhysicalPresenceBadgeProps> = ({
  count,
}) => {
  if (count === 0) {
    return null;
  }

  const displayCount = count > 99 ? '99+' : String(count);

  return (
    <Box
      testID="presence-badge"
      style={{
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text testID="presence-badge-icon" style={{ fontSize: 20 }}>
        {'⚠️'}
      </Text>
      <Badge
        style={{
          position: 'absolute',
          top: -5,
          right: -10,
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: '#F59E0B',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 0,
          paddingVertical: 0,
        }}
      >
        <BadgeText
          style={{
            fontSize: 10,
            color: '#FFFFFF',
            fontWeight: '700',
          }}
        >
          {displayCount}
        </BadgeText>
      </Badge>
    </Box>
  );
};
