import React from 'react';
import {
  Badge,
  BadgeText,
  Box,
  Pressable,
  Text,
  VStack,
} from '@gluestack-ui/themed';
import { AuthorizationRequestDto, RequestType } from '@open-supervisor/shared-types';

type RequestWithResolved = AuthorizationRequestDto & {
  resolved?: 'APPROVED' | 'REJECTED';
};

interface AuthorizationCardProps {
  request: RequestWithResolved;
  onPress: () => void;
  isPhysicalPresence?: boolean;
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
  } catch {
    return isoString;
  }
}

function getBadgeLabel(resolved?: 'APPROVED' | 'REJECTED'): string {
  if (resolved === 'APPROVED') return 'Autorizada';
  if (resolved === 'REJECTED') return 'Rechazada';
  return 'Pendiente';
}

const TYPE_COLORS: Record<RequestType, string> = {
  [RequestType.DISCOUNT]: '#2196F3',
  [RequestType.CANCEL]: '#F44336',
  [RequestType.EMPLOYEE_BENEFIT]: '#9C27B0',
  [RequestType.SUSPEND]: '#FF9800',
  [RequestType.PRICE_CHANGE]: '#4CAF50',
};

export const AuthorizationCard: React.FC<AuthorizationCardProps> = ({
  request,
  onPress,
  isPhysicalPresence = false,
}) => {
  const badgeLabel = getBadgeLabel(request.resolved);
  const typeColor = TYPE_COLORS[request.type] ?? '#607D8B';
  const testID = isPhysicalPresence
    ? `presence-card-${request.correlation_id}`
    : 'authorization-card';
  const cardBackground = isPhysicalPresence ? '#FEF3C7' : '#FFFFFF';

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        marginVertical: 4,
        marginHorizontal: 8,
        backgroundColor: cardBackground,
        borderRadius: 8,
        elevation: 2,
      }}
    >
      {!isPhysicalPresence && (
        <Box
          testID={`type-icon-${request.type}`}
          style={{
            width: 8,
            borderRadius: 4,
            alignSelf: 'stretch',
            marginRight: 12,
            backgroundColor: typeColor,
          }}
        />
      )}
      <VStack style={{ flex: 1 }}>
        {isPhysicalPresence ? (
          <>
            <Text
              style={{ fontSize: 14, fontWeight: '600', color: '#212121' }}
            >
              {request.product_id}
            </Text>
            <Text style={{ fontSize: 12, color: '#616161', marginTop: 2 }}>
              {request.pos_id}
            </Text>
            <Text style={{ fontSize: 11, color: '#9E9E9E', marginTop: 2 }}>
              ${request.original_price} → ${request.requested_price}
            </Text>
          </>
        ) : (
          <>
            <Text
              style={{ fontSize: 14, fontWeight: '600', color: '#212121' }}
            >
              {request.type}
            </Text>
            <Text style={{ fontSize: 12, color: '#616161', marginTop: 2 }}>
              {request.pos_id}
            </Text>
            <Text
              testID="card-created-at"
              style={{ fontSize: 11, color: '#9E9E9E', marginTop: 2 }}
            >
              {formatDate(request.created_at)}
            </Text>
          </>
        )}
      </VStack>
      {isPhysicalPresence ? (
        <Badge
          style={{
            paddingHorizontal: 8,
            paddingVertical: 4,
            backgroundColor: '#FEF3C7',
            borderRadius: 12,
            borderWidth: 1,
            borderColor: '#F59E0B',
          }}
        >
          <BadgeText style={{ fontSize: 11, color: '#92400E' }}>
            Presencial
          </BadgeText>
        </Badge>
      ) : (
        <Badge
          style={{
            paddingHorizontal: 8,
            paddingVertical: 4,
            backgroundColor: '#EEEEEE',
            borderRadius: 12,
          }}
        >
          <BadgeText style={{ fontSize: 11, color: '#424242' }}>
            {badgeLabel}
          </BadgeText>
        </Badge>
      )}
    </Pressable>
  );
};
